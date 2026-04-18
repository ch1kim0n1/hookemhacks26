import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPool } from "./db.js";
import { log } from "./logger.js";

export interface AuditEntry {
    tenantId?: string;
    userId?: string;
    action: string; // "create" | "update" | "delete" | "read" | "execute"
    resourceType: string; // "tenant" | "user" | "address" | "scenario" | "snapshot"
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
}

/**
 * Write an audit log entry to Postgres.
 * Fire-and-forget — audit failures should not block the request.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
    try {
        const pool = getPool();
        await pool.query(
            `INSERT INTO audit_log (tenant_id, user_id, action, resource_type, resource_id, details, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                entry.tenantId || null,
                entry.userId || null,
                entry.action,
                entry.resourceType,
                entry.resourceId || null,
                entry.details ? JSON.stringify(entry.details) : null,
                entry.ipAddress || null,
            ],
        );
    } catch (err) {
        // Audit failures must not crash the service
        log.error({ err, entry }, "audit log write failed");
    }
}

/**
 * Fastify hook that logs all state-changing requests (POST, PATCH, PUT, DELETE).
 * Runs after the response is sent (onResponse hook).
 */
export function registerAuditHook(app: FastifyInstance): void {
    app.addHook("onResponse", async (req: FastifyRequest, reply: FastifyReply) => {
        // Only audit state-changing methods
        const method = req.method.toUpperCase();
        if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) return;

        // Skip health/metrics endpoints
        const url = req.url.split("?")[0];
        if (url === "/api/v1/health" || url === "/metrics") return;

        const user = (req as any).user;
        const { action, resourceType, resourceId } = classifyRequest(method, url);

        await writeAuditLog({
            tenantId: user?.tenant_id,
            userId: user?.sub,
            action,
            resourceType,
            resourceId,
            details: {
                method,
                url,
                statusCode: reply.statusCode,
            },
            ipAddress: req.ip,
        });
    });
}

/** Classify a request into action + resource type for the audit log */
export function classifyRequest(
    method: string,
    url: string,
): {
    action: string;
    resourceType: string;
    resourceId?: string;
} {
    // Admin tenant routes
    const tenantMatch = url.match(/^\/api\/v1\/admin\/tenants\/([^/]+)/);
    if (tenantMatch) {
        const tenantId = tenantMatch[1];
        if (url.includes("/addresses")) {
            return { action: method === "POST" ? "create" : "read", resourceType: "address", resourceId: tenantId };
        }
        if (url.includes("/users")) {
            return { action: "create", resourceType: "user", resourceId: tenantId };
        }
        if (method === "PATCH") return { action: "update", resourceType: "tenant", resourceId: tenantId };
        return { action: "read", resourceType: "tenant", resourceId: tenantId };
    }
    if (url === "/api/v1/admin/tenants") {
        return { action: "create", resourceType: "tenant" };
    }
    if (url === "/api/v1/admin/snapshot") {
        return { action: "execute", resourceType: "snapshot" };
    }

    // Demo routes
    if (url.includes("/demo/replay-scenario")) {
        return { action: "execute", resourceType: "scenario", resourceId: "scenario-a" };
    }
    if (url.includes("/demo/inject-instruction")) {
        return { action: "execute", resourceType: "scenario", resourceId: "scenario-b" };
    }

    // Auth
    if (url === "/auth/token") {
        return { action: "execute", resourceType: "auth" };
    }

    return { action: method.toLowerCase(), resourceType: "unknown" };
}

/**
 * REST endpoint to query audit logs (admin-only).
 */
export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
    const pool = getPool();

    app.get<{ Querystring: { tenant_id?: string; limit?: string; offset?: string } }>(
        "/api/v1/admin/audit",
        async (req, reply) => {
            const user = (req as any).user;
            if (!user || user.role !== "admin") {
                reply.code(403);
                return { error: "admin role required" };
            }
            const limit = Math.min(Number.parseInt(req.query.limit ?? "50", 10), 200);
            const offset = Number.parseInt(req.query.offset ?? "0", 10);
            const tenantFilter = req.query.tenant_id;

            let query =
                "SELECT id, tenant_id, user_id, action, resource_type, resource_id, details, ip_address, created_at FROM audit_log";
            const params: any[] = [];
            if (tenantFilter) {
                query += " WHERE tenant_id = $1";
                params.push(tenantFilter);
            }
            query += " ORDER BY created_at DESC";
            query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limit, offset);

            const { rows } = await pool.query(query, params);
            return { audit: rows, limit, offset };
        },
    );
}
