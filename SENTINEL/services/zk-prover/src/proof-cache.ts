// Two-tier proof cache for the zk-prover service.
//
//   L1 — in-memory LRU-ish map (fast path, cleared on restart)
//   L2 — Postgres `proof_cache` table (survives restarts, shared across
//        replicas, seeded by `scripts/pre-warm-proofs.sh`)
//
// Both tiers are keyed by `(circuit, inputHash)` where `inputHash` is a
// content-addressed SHA-256 of the canonical-JSON guest inputs.

import { createHash } from "node:crypto";
import pg from "pg";
import { log } from "./logger.js";

export interface CachedProof {
    proof: string; // 0x-prefixed hex seal
    publicInputs: string[];
    imageId: string;
    journal: string;
    elapsedMs: number;
    circuit: string;
    cached: boolean;
}

export type Circuit = "policy-compliance" | "counterfactual-correctness" | "learning-correctness";

export function inputKey(input: unknown): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

type CacheKey = `${Circuit}:${string}`;

function k(circuit: Circuit, hash: string): CacheKey {
    return `${circuit}:${hash}`;
}

const L1_MAX = 512;

/** Simple insertion-order LRU: on overflow, drop oldest key. */
class L1 {
    private map = new Map<CacheKey, CachedProof>();

    get(key: CacheKey): CachedProof | undefined {
        const hit = this.map.get(key);
        if (!hit) return undefined;
        // Refresh ordering — delete + re-set so this key is "newest".
        this.map.delete(key);
        this.map.set(key, hit);
        return hit;
    }

    set(key: CacheKey, val: CachedProof): void {
        if (this.map.has(key)) this.map.delete(key);
        this.map.set(key, val);
        while (this.map.size > L1_MAX) {
            const oldest = this.map.keys().next().value;
            if (oldest === undefined) break;
            this.map.delete(oldest);
        }
    }

    get size(): number {
        return this.map.size;
    }
}

export class ProofCache {
    private l1 = new L1();
    private pool: pg.Pool | null;

    constructor(postgresUrl: string | undefined) {
        this.pool = postgresUrl ? new pg.Pool({ connectionString: postgresUrl, max: 4 }) : null;
        if (!this.pool) {
            log.warn("proof cache L2 disabled (no POSTGRES_URL)");
        }
    }

    async get(circuit: Circuit, hash: string): Promise<CachedProof | null> {
        const key = k(circuit, hash);
        const hit1 = this.l1.get(key);
        if (hit1) {
            return { ...hit1, cached: true };
        }
        if (!this.pool) return null;
        try {
            const res = await this.pool.query(
                `UPDATE proof_cache
                 SET hit_count = hit_count + 1, last_hit_at = now()
                 WHERE input_hash = $1 AND circuit = $2
                 RETURNING seal, public_inputs, journal, image_id, elapsed_ms`,
                [hash, circuit],
            );
            if (res.rowCount === 0) return null;
            const row = res.rows[0];
            const result: CachedProof = {
                proof: "0x" + row.seal.toString("hex"),
                publicInputs: row.public_inputs,
                imageId: row.image_id,
                journal: "0x" + row.journal.toString("hex"),
                elapsedMs: row.elapsed_ms,
                circuit,
                cached: true,
            };
            this.l1.set(key, result);
            return result;
        } catch (err) {
            log.error({ err: String(err), circuit, hash }, "L2 cache read failed");
            return null;
        }
    }

    async set(circuit: Circuit, hash: string, proof: CachedProof): Promise<void> {
        const key = k(circuit, hash);
        this.l1.set(key, proof);
        if (!this.pool) return;
        try {
            const sealBuf = Buffer.from(stripHex(proof.proof), "hex");
            const journalBuf = Buffer.from(stripHex(proof.journal), "hex");
            await this.pool.query(
                `INSERT INTO proof_cache
                   (input_hash, circuit, seal, public_inputs, journal, image_id, elapsed_ms)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (input_hash, circuit) DO UPDATE
                   SET seal = EXCLUDED.seal,
                       public_inputs = EXCLUDED.public_inputs,
                       journal = EXCLUDED.journal,
                       image_id = EXCLUDED.image_id,
                       elapsed_ms = EXCLUDED.elapsed_ms,
                       generated_at = now()`,
                [
                    hash,
                    circuit,
                    sealBuf,
                    JSON.stringify(proof.publicInputs),
                    journalBuf,
                    proof.imageId,
                    proof.elapsedMs,
                ],
            );
        } catch (err) {
            log.error({ err: String(err), circuit, hash }, "L2 cache write failed");
        }
    }

    get l1Size(): number {
        return this.l1.size;
    }

    get hasL2(): boolean {
        return this.pool !== null;
    }

    async close(): Promise<void> {
        if (this.pool) await this.pool.end();
    }
}

function stripHex(s: string): string {
    return s.startsWith("0x") ? s.slice(2) : s;
}
