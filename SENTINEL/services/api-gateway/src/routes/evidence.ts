import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { http, createPublicClient, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { EventEnvelope } from "../cues.js";

// Matches CounterfactualLedger.sol entry struct.
const LEDGER_ABI = parseAbi([
    "function getEntry(bytes32 eventId) view returns ((bytes32 eventId,uint256 atBlock,int256 deltaWei,bytes32 realTxHash,bytes32 counterfactualRoot,bytes32 proofDigest,uint256 recordedAt))",
]);

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";

// Deterministic signing key for the evidence bundle. Anvil default
// account #0 in dev; operators override via SENTINEL_EVIDENCE_KEY in
// production. Keeps the proof audit chain verifiable without pulling
// in a post-quantum dependency we can't defend under questioning.
const EVIDENCE_KEY =
    (process.env.SENTINEL_EVIDENCE_KEY as `0x${string}` | undefined) ??
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

interface ApprovalRecord {
    approver: string;
    decidedAt: string;
    decision: "approve" | "reject";
    note?: string;
}

/**
 * Evidence export bundle — one deterministic JSON blob a judge or
 * auditor can download and re-verify offline. Fields are sourced from
 * the same event envelopes the WS firehose already broadcasts, so a
 * fresh consumer can reproduce the bundle by replaying the stream.
 */
interface EvidenceBundle {
    schemaVersion: "sentinel-evidence/v1";
    eventId: string;
    status: "recorded" | "mined" | "submitted" | "detected" | "rejected" | "pending_approval";
    detection: {
        timestamp: string | null;
        pattern: string | null;
        confidence: number | null;
    };
    defense: {
        txHash: string | null;
        minedAt: string | null;
        blockNumber: number | null;
        proofDigest: string | null;
        failClosed: boolean;
        rejectionReason: string | null;
    };
    counterfactual: {
        root: string | null;
        deltaWei: string | null;
        atBlock: number | null;
    };
    ledger: {
        recorded: boolean;
        realTxHash: string | null;
        recordedAt: number | null;
    };
    approval: ApprovalRecord | null;
    digest: {
        algorithm: "sha256";
        value: string;
    };
    signature: {
        algorithm: "ecdsa-secp256k1";
        signer: string;
        value: string;
    };
}

export async function registerEvidenceRoutes(
    app: FastifyInstance,
    addresses: Record<string, string>,
    recentEvents: EventEnvelope[],
    counterfactualTrees: Map<string, unknown>,
    approvalRecords: Map<string, ApprovalRecord>,
): Promise<void> {
    const account = privateKeyToAccount(EVIDENCE_KEY);

    app.get<{ Params: { eventId: string } }>(
        "/api/v1/evidence/:eventId/export",
        async (req, reply) => {
            const { eventId } = req.params;

            const related = recentEvents.filter(
                (e) => (e.data as Record<string, unknown>).eventId === eventId,
            );

            if (related.length === 0) {
                reply.code(404);
                return {
                    error: {
                        code: "NOT_FOUND",
                        message: "no events observed for this eventId",
                    },
                };
            }

            const detection = related.find((e) => e.kind === "THREAT_CONFIRMED");
            const defense = related.find((e) => e.kind === "DEFENSE_SUBMITTED");
            const mined = related.find((e) => e.kind === "DEFENSE_MINED");
            const rejected = related.find((e) => e.kind === "DEFENSE_REJECTED");
            const counterfactual = related.find((e) => e.kind === "COUNTERFACTUAL_READY");
            const ledger = related.find((e) => e.kind === "LEDGER_RECORDED");

            const d = <T = Record<string, unknown>>(env: EventEnvelope | undefined): T =>
                (env?.data ?? {}) as T;

            // On-chain ledger entry is authoritative when present — pulls the
            // finalized deltaWei/recordedAt the contract actually stored.
            let ledgerEntry: {
                deltaWei: string | null;
                atBlock: number | null;
                realTxHash: string | null;
                counterfactualRoot: string | null;
                recordedAt: number | null;
            } = {
                deltaWei: null,
                atBlock: null,
                realTxHash: null,
                counterfactualRoot: null,
                recordedAt: null,
            };
            try {
                const client = createPublicClient({ transport: http(RPC_URL) });
                const entry = (await client.readContract({
                    address: addresses.CounterfactualLedger as `0x${string}`,
                    abi: LEDGER_ABI,
                    functionName: "getEntry",
                    args: [eventId as `0x${string}`],
                })) as {
                    eventId: `0x${string}`;
                    atBlock: bigint;
                    deltaWei: bigint;
                    realTxHash: `0x${string}`;
                    counterfactualRoot: `0x${string}`;
                    proofDigest: `0x${string}`;
                    recordedAt: bigint;
                };
                // atBlock==0 means the contract has never recorded this eventId.
                if (Number(entry.atBlock) > 0 || Number(entry.recordedAt) > 0) {
                    ledgerEntry = {
                        deltaWei: entry.deltaWei.toString(),
                        atBlock: Number(entry.atBlock),
                        realTxHash: entry.realTxHash,
                        counterfactualRoot: entry.counterfactualRoot,
                        recordedAt: Number(entry.recordedAt),
                    };
                }
            } catch {
                // RPC down or ledger not deployed — fall back to stream data.
            }

            const cfRoot =
                ledgerEntry.counterfactualRoot ??
                (d(counterfactual).counterfactualRoot as string | undefined) ??
                null;
            const deltaWei =
                ledgerEntry.deltaWei ??
                (d(counterfactual).damagePrevented as string | undefined) ??
                null;

            const status: EvidenceBundle["status"] = ledger
                ? "recorded"
                : mined
                  ? "mined"
                  : rejected
                    ? "rejected"
                    : defense
                      ? "submitted"
                      : detection
                        ? "detected"
                        : "pending_approval";

            const bundle: Omit<EvidenceBundle, "digest" | "signature"> = {
                schemaVersion: "sentinel-evidence/v1",
                eventId,
                status,
                detection: {
                    timestamp: detection?.emittedAt ?? null,
                    pattern: (d(detection).pattern as string | undefined) ?? null,
                    confidence:
                        typeof d(detection).confidence === "number"
                            ? (d(detection).confidence as number)
                            : null,
                },
                defense: {
                    txHash: (d(defense).txHash as string | undefined) ?? null,
                    minedAt: mined?.emittedAt ?? null,
                    blockNumber:
                        typeof d(mined).blockNumber === "number"
                            ? (d(mined).blockNumber as number)
                            : null,
                    proofDigest: (d(mined).proofDigest as string | undefined) ?? null,
                    failClosed: Boolean(rejected),
                    rejectionReason: (d(rejected).reason as string | undefined) ?? null,
                },
                counterfactual: {
                    root: cfRoot,
                    deltaWei,
                    atBlock: ledgerEntry.atBlock,
                },
                ledger: {
                    recorded: Boolean(ledger) || ledgerEntry.atBlock !== null,
                    realTxHash: ledgerEntry.realTxHash,
                    recordedAt: ledgerEntry.recordedAt,
                },
                approval: approvalRecords.get(eventId) ?? null,
            };

            // Canonical JSON: sorted keys → stable digest → reproducible
            // signature across runs. Anything a verifier would want to
            // reproduce must go through this function.
            const canonical = canonicalJson(bundle);
            const digest = createHash("sha256").update(canonical).digest("hex");
            const signature = await account.signMessage({ message: canonical });

            const signed: EvidenceBundle = {
                ...bundle,
                digest: { algorithm: "sha256", value: "0x" + digest },
                signature: {
                    algorithm: "ecdsa-secp256k1",
                    signer: account.address,
                    value: signature,
                },
            };

            // Suggest a filename so `curl -OJ` / browser downloads name
            // the bundle after the eventId it belongs to.
            reply.header(
                "content-disposition",
                `attachment; filename="sentinel-evidence-${eventId.slice(0, 18)}.json"`,
            );
            reply.header("content-type", "application/json");
            return signed;
        },
    );
}

/**
 * RFC 8785-style canonicalization: sort object keys, no whitespace.
 * Arrays preserve order. Keeps the signature stable across Node
 * versions and JSON.stringify implementations.
 */
function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
    const entries = Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonicalJson((value as Record<string, unknown>)[k]));
    return "{" + entries.join(",") + "}";
}

export type { ApprovalRecord };
