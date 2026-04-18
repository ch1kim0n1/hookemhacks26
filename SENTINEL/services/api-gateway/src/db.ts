import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { log } from "./logger.js";

export interface DbConfig {
    connectionString: string;
}

let pool: pg.Pool | null = null;

export function getPool(config?: DbConfig): pg.Pool {
    if (!pool) {
        pool = new pg.Pool({
            connectionString:
                config?.connectionString ??
                process.env.POSTGRES_URL ??
                "postgresql://sentinel:sentinel@127.0.0.1:5432/sentinel",
            // Fail fast on unreachable DB during startup rather than hanging.
            connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS ?? 5_000),
        });
    }
    return pool;
}

/** Wait for the DB to accept connections with exponential backoff. */
async function waitForConnection(p: pg.Pool, maxAttempts = 10): Promise<void> {
    let delay = 250;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const c = await p.connect();
            c.release();
            return;
        } catch (err) {
            if (attempt === maxAttempts) {
                throw new Error(`postgres unreachable after ${maxAttempts} attempts: ${(err as Error).message}`);
            }
            log.warn({ attempt, delay }, "postgres not ready, retrying");
            await new Promise((r) => setTimeout(r, delay));
            delay = Math.min(delay * 2, 4_000);
        }
    }
}

async function ensureSchemaVersionTable(p: pg.Pool): Promise<void> {
    await p.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename    TEXT PRIMARY KEY,
            checksum    TEXT NOT NULL,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

function checksum(contents: string): string {
    return createHash("sha256").update(contents).digest("hex");
}

/**
 * Run migrations with recovery:
 *  - waits for the DB to come up (exponential backoff)
 *  - tracks applied migrations in `schema_migrations` so we don't re-run
 *  - each migration runs in its own transaction; failure rolls back cleanly
 *  - on checksum drift, logs the conflict but keeps serving (read path still works);
 *    if SENTINEL_DB_ALLOW_RESET=1 is set, the service wipes tracking and re-applies
 */
export async function runMigrations(p: pg.Pool): Promise<void> {
    const migrationsDir = join(__dirname, "..", "migrations");
    let files: string[];
    try {
        files = readdirSync(migrationsDir)
            .filter((f) => f.endsWith(".sql"))
            .sort();
    } catch {
        log.warn("no migrations directory found, skipping");
        return;
    }
    if (files.length === 0) {
        log.info("no migration files present");
        return;
    }

    await waitForConnection(p);
    await ensureSchemaVersionTable(p);

    const allowReset = process.env.SENTINEL_DB_ALLOW_RESET === "1";
    const applied = await p.query<{ filename: string; checksum: string }>(
        "SELECT filename, checksum FROM schema_migrations",
    );
    const appliedMap = new Map(applied.rows.map((r) => [r.filename, r.checksum]));

    let ran = 0;
    let skipped = 0;
    for (const file of files) {
        const sql = readFileSync(join(migrationsDir, file), "utf-8");
        const sum = checksum(sql);
        const prior = appliedMap.get(file);

        if (prior === sum) {
            skipped++;
            continue;
        }
        if (prior && prior !== sum) {
            if (!allowReset) {
                log.error(
                    { file, priorChecksum: prior.slice(0, 12), currentChecksum: sum.slice(0, 12) },
                    "migration checksum drift — set SENTINEL_DB_ALLOW_RESET=1 to reapply",
                );
                continue;
            }
            log.warn({ file }, "resetting migration tracking for drifted file (SENTINEL_DB_ALLOW_RESET=1)");
            await p.query("DELETE FROM schema_migrations WHERE filename = $1", [file]);
        }

        const client = await p.connect();
        try {
            await client.query("BEGIN");
            await client.query(sql);
            await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [file, sum]);
            await client.query("COMMIT");
            ran++;
            log.info({ file }, "migration applied");
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            const code = (err as { code?: string }).code;
            // Idempotent migrations may legitimately no-op (duplicate object errors
            // with IF NOT EXISTS). Record them so we don't retry indefinitely.
            if (code === "42P07" || code === "42710" || code === "42701") {
                log.warn({ file, code }, "migration already satisfied; recording checksum");
                await p.query(
                    "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum",
                    [file, sum],
                );
                ran++;
            } else {
                log.error({ err: (err as Error).message, file, code }, "migration failed");
                throw err;
            }
        } finally {
            client.release();
        }
    }
    log.info({ ran, skipped, total: files.length }, "migrations complete");
}

/**
 * Set the current tenant for RLS-scoped queries.
 * Call this at the start of each request.
 */
export async function setTenantContext(client: pg.PoolClient, tenantId: string): Promise<void> {
    await client.query(`SET LOCAL app.current_tenant_id = $1`, [tenantId]);
}
