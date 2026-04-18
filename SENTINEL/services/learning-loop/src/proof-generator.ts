import { createHash } from "node:crypto";
import { log } from "./logger.js";

export interface LearningProof {
    /** Hex-encoded proof bytes */
    proofHex: string;
    /** Public inputs: [oldPolicyHash, newPolicyHash, winRateBp, generationCount] */
    publicInputs: string[];
    generationCount: number;
    winRate: number;
    elapsedMs: number;
}

export interface LearningProofInput {
    oldPolicyHash: string;
    newPolicyJson: string;
    generationCount: number;
    winRate: number;
    /** Per-generation attack/defence counts — required for real ZK proof. */
    generations?: Array<{ attackCount: number; defendedCount: number }>;
}

function hexToBytes(hex: string): number[] {
    const h = hex.startsWith("0x") ? hex.slice(2) : hex;
    const padded = h.padStart(64, "0").slice(0, 64);
    const out: number[] = [];
    for (let i = 0; i < 64; i += 2) out.push(parseInt(padded.slice(i, i + 2), 16));
    return out;
}

async function callZkProver(
    proverUrl: string,
    oldHash: string,
    newHash: string,
    winRate: number,
    generations: Array<{ attackCount: number; defendedCount: number }>,
): Promise<{ proofHex: string; publicInputs: string[] }> {
    const body = {
        old_policy_hash: hexToBytes(oldHash),
        new_policy_hash: hexToBytes(newHash),
        min_win_rate_bp: Math.round(winRate * 10_000),
        min_generations: 1,
        event_batch_root: Array(32).fill(0),
        generations: generations.map((g) => ({
            attack_count: g.attackCount,
            defended_count: g.defendedCount,
        })),
    };

    const resp = await fetch(`${proverUrl}/prove/learning`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        throw new Error(`ZK prover /prove/learning returned ${resp.status}: ${text}`);
    }

    const result = (await resp.json()) as { proof: string; publicInputs: string[] };
    return { proofHex: result.proof, publicInputs: result.publicInputs };
}

function stubProof(oldHash: string, newHash: string, generationCount: number, winRate: number): LearningProof {
    const proofInput = JSON.stringify({ oldHash, newHash, generations: generationCount, winRate });
    const proofHex = "0x" + createHash("sha256").update(proofInput).digest("hex").repeat(4);
    const winRateBp =
        "0x" +
        Math.round(winRate * 10_000)
            .toString(16)
            .padStart(64, "0");
    const genCountHex = "0x" + generationCount.toString(16).padStart(64, "0");
    return {
        proofHex,
        publicInputs: [oldHash, newHash, winRateBp, genCountHex],
        generationCount,
        winRate,
        elapsedMs: 0,
    };
}

export async function generateLearningProof(input: LearningProofInput): Promise<LearningProof> {
    const start = Date.now();
    const newPolicyHash = "0x" + createHash("sha256").update(input.newPolicyJson).digest("hex");
    const zkProverUrl = process.env.ZK_PROVER_URL;

    if (zkProverUrl && input.generations && input.generations.length > 0) {
        try {
            log.info(
                {
                    oldHash: input.oldPolicyHash.slice(0, 10) + "...",
                    newHash: newPolicyHash.slice(0, 10) + "...",
                    generations: input.generations.length,
                    winRate: input.winRate,
                },
                "requesting learning proof from ZK prover",
            );
            const { proofHex, publicInputs } = await callZkProver(
                zkProverUrl,
                input.oldPolicyHash,
                newPolicyHash,
                input.winRate,
                input.generations,
            );
            const elapsedMs = Date.now() - start;
            log.info({ elapsedMs }, "learning proof received from ZK prover");
            return {
                proofHex,
                publicInputs,
                generationCount: input.generationCount,
                winRate: input.winRate,
                elapsedMs,
            };
        } catch (err) {
            log.warn({ err }, "ZK prover call failed, falling back to stub proof");
        }
    } else if (zkProverUrl && (!input.generations || input.generations.length === 0)) {
        log.warn("ZK_PROVER_URL set but no generation data provided — using stub proof");
    }

    const proof = stubProof(input.oldPolicyHash, newPolicyHash, input.generationCount, input.winRate);
    proof.elapsedMs = Date.now() - start;
    log.info(
        {
            oldHash: input.oldPolicyHash.slice(0, 10) + "...",
            newHash: newPolicyHash.slice(0, 10) + "...",
            generationCount: input.generationCount,
            winRate: input.winRate,
            elapsedMs: proof.elapsedMs,
        },
        "learning proof generated (dev-mode stub)",
    );
    return proof;
}
