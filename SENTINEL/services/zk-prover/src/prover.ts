// Wraps the Rust prove_* bins with the two-tier proof cache. Exported so
// both the HTTP endpoints (index.ts) and the ledger_publisher can share
// one cache instance in-process.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { type CachedProof, type Circuit, ProofCache, inputKey } from "./proof-cache.js";

const _here = dirname(fileURLToPath(import.meta.url));
const zkTargetDir = join(_here, "..", "..", "..", "zk", "target", "release");

export const BINS: Record<Circuit, string> = {
    "policy-compliance": process.env.PROVE_POLICY_BIN ?? join(zkTargetDir, "prove_policy"),
    "counterfactual-correctness": process.env.PROVE_COUNTERFACTUAL_BIN ?? join(zkTargetDir, "prove_counterfactual"),
    "learning-correctness": process.env.PROVE_LEARNING_BIN ?? join(zkTargetDir, "prove_learning"),
};

// Per-circuit timeout before falling back to cache (doc 04 §Caching).
// Local: policy ~30s, counterfactual ~10s Bonsai, learning ~60s.
// Override via env for Bonsai path where times are 2–10x faster.
export const CIRCUIT_TIMEOUT_MS: Record<Circuit, number> = {
    "policy-compliance": Number(process.env.PROVE_TIMEOUT_POLICY_MS ?? 35_000),
    "counterfactual-correctness": Number(process.env.PROVE_TIMEOUT_COUNTERFACTUAL_MS ?? 15_000),
    "learning-correctness": Number(process.env.PROVE_TIMEOUT_LEARNING_MS ?? 70_000),
};

export interface ProverOutput {
    proof: string;
    publicInputs: string[];
    imageId: string;
    journal: string;
    elapsedMs: number;
    circuit: string;
}

// Spawns the Rust prover bin and resolves with its JSON output.
// Kills the child process when `signal` is aborted so we don't leak
// long-running prove processes after a cache fallback.
export async function runProver(circuit: Circuit, inputJson: string, signal?: AbortSignal): Promise<ProverOutput> {
    return await new Promise((resolve, reject) => {
        const child = spawn(BINS[circuit], [], {
            stdio: ["pipe", "pipe", "pipe"],
            env: {
                ...process.env,
                RISC0_DEV_MODE: process.env.RISC0_DEV_MODE ?? "0",
            },
        });

        const onAbort = () => {
            child.kill("SIGTERM");
            reject(new Error(`${circuit} prover aborted`));
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", (err) => {
            signal?.removeEventListener("abort", onAbort);
            reject(err);
        });
        child.on("close", (code) => {
            signal?.removeEventListener("abort", onAbort);
            if (code !== 0) {
                return reject(new Error(`${circuit} exited ${code}: ${stderr.slice(-500)}`));
            }
            try {
                resolve(JSON.parse(stdout.trim()) as ProverOutput);
            } catch {
                reject(new Error(`${circuit} stdout parse: ${stdout.slice(-500)}`));
            }
        });
        child.stdin.write(inputJson);
        child.stdin.end();
    });
}

export type ProveFn = (circuit: Circuit, input: unknown) => Promise<CachedProof>;

// Circuit-breaker pattern from doc 04 §Hackathon Reality:
//   1. Check L1/L2 cache — return immediately on hit.
//   2. Spawn live prover with a per-circuit timeout.
//   3. On timeout: kill the prover process, re-check cache (pre-warmed
//      proofs land here), surface a clear error if still a miss.
export function makeProver(cache: ProofCache): ProveFn {
    return async function prove(circuit: Circuit, input: unknown): Promise<CachedProof> {
        const hash = inputKey(input);
        const hit = await cache.get(circuit, hash);
        if (hit) return hit;

        const timeoutMs = CIRCUIT_TIMEOUT_MS[circuit];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let result: ProverOutput;
        try {
            result = await runProver(circuit, JSON.stringify(input), controller.signal);
        } catch (err) {
            const timedOut = controller.signal.aborted;
            clearTimeout(timer);
            if (timedOut) {
                log.warn({ circuit, hash, timeoutMs }, "prover timeout — falling back to cache");
                const fallback = await cache.get(circuit, hash);
                if (fallback) return { ...fallback, cached: true };
                throw new Error(
                    `${circuit} timed out after ${timeoutMs}ms with no cached proof — ` +
                        "pre-warm via scripts/pre-warm-proofs.sh",
                );
            }
            throw err;
        }
        clearTimeout(timer);

        const cached: CachedProof = {
            proof: result.proof,
            publicInputs: result.publicInputs,
            imageId: result.imageId,
            journal: result.journal,
            elapsedMs: result.elapsedMs,
            circuit,
            cached: false,
        };
        await cache.set(circuit, hash, cached);
        log.info({ circuit, hash, elapsedMs: result.elapsedMs }, "proof generated");
        return cached;
    };
}
