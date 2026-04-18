import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { http, createPublicClient, parseAbi } from "viem";
import { getPool } from "../db.js";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const POLICY_PATH = process.env.POLICY_PATH ?? "../../config/policy.json";

export async function registerPolicyRoutes(app: FastifyInstance, addresses: Record<string, string>): Promise<void> {
    app.get("/api/v1/policy/current", async () => {
        const policyRaw = readFileSync(POLICY_PATH, "utf-8");
        const parsed = JSON.parse(policyRaw);
        const canonical = JSON.stringify(parsed);
        const expectedHash = "0x" + createHash("sha256").update(canonical).digest("hex");

        let onChain: string | null = null;
        let version: number | null = null;
        try {
            const client = createPublicClient({ transport: http(RPC_URL) });
            const [hash, ver] = await Promise.all([
                client.readContract({
                    address: addresses.PolicyRegistry as `0x${string}`,
                    abi: parseAbi(["function currentPolicyHash() view returns (bytes32)"]),
                    functionName: "currentPolicyHash",
                }),
                client.readContract({
                    address: addresses.PolicyRegistry as `0x${string}`,
                    abi: parseAbi(["function policyVersion() view returns (uint256)"]),
                    functionName: "policyVersion",
                }),
            ]);
            onChain = hash as string;
            version = Number(ver);
        } catch {
            /* chain unreachable — return the expected hash only */
        }

        return {
            hash: onChain,
            expectedHash,
            version,
            matches: onChain !== null && onChain.toLowerCase() === expectedHash.toLowerCase(),
            document: parsed,
        };
    });

    app.get("/api/v1/policy/history", async () => {
        const pool = getPool();
        const { rows } = await pool.query(
            `SELECT id, tenant_id, details, created_at FROM audit_log
             WHERE resource_type = 'policy' OR action = 'policy_update'
             ORDER BY created_at DESC LIMIT 50`,
        );
        return { history: rows };
    });
}
