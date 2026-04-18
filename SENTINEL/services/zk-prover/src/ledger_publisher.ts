// ledger_publisher
//
// Subscribes to sentinel.counterfactual.ready, generates a real
// CounterfactualCorrectness proof via the shared `ProveFn`, and records
// the entry on-chain. The guest's committed Merkle root (from its
// `publicInputs[1]`) is what the `CounterfactualLedger.Entry`
// `counterfactualRoot` stores — the sim's root is advisory only.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { StreamConsumer, StreamPublisher } from "@sentinel/stream-client";
import Redis from "ioredis";
import { http, createPublicClient, createWalletClient, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { log } from "./logger.js";
import type { ProveFn } from "./prover.js";

const LEDGER_ABI = parseAbi([
    "function record((bytes32 eventId,uint256 atBlock,int256 deltaWei,bytes32 realTxHash,bytes32 counterfactualRoot,bytes32 proofDigest,uint256 recordedAt) entry, bytes proof, bytes32[] publicInputs)",
]);

export interface DeltaLeaf {
    address: `0x${string}`;
    label: string;
    realWei: string;
    shadowWei: string;
    deltaWei: string;
}

export interface CounterfactualReadyEvent {
    eventId: `0x${string}`;
    deltaWei: string;
    counterfactualRoot: `0x${string}`;
    victimProtocol: `0x${string}`;
    leaves: DeltaLeaf[];
    forkBlock: number;
    /** Block hash of the Anvil fork — binds the proof to a real historical block. */
    forkBlockHash?: `0x${string}`;
}

export interface EntryExtras {
    realTxHash: `0x${string}`;
    proofDigest: `0x${string}`;
}

/** Convert a bigint to 32-byte big-endian two's-complement. */
function int256ToBytes32(n: bigint): number[] {
    const u = n < 0n ? (1n << 256n) + n : n;
    const hex = u.toString(16).padStart(64, "0");
    const out: number[] = new Array(32);
    for (let i = 0; i < 32; i++) {
        out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function hexToBytes(hex: `0x${string}`, expectedLen: number): number[] {
    const raw = hex.slice(2);
    if (raw.length !== expectedLen * 2) {
        throw new Error(`expected ${expectedLen} bytes, got ${raw.length / 2}`);
    }
    const out: number[] = new Array(expectedLen);
    for (let i = 0; i < expectedLen; i++) {
        out[i] = Number.parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function sha256Bytes(data: string): number[] {
    const digest = createHash("sha256").update(data, "utf8").digest();
    return Array.from(digest);
}

/**
 * Translate a sim CounterfactualReadyEvent into the
 * `CounterfactualInputs` shape the guest deserializes. Only
 * victim-prefixed leaves contribute to the claimed delta; their
 * `real - shadow` wei differences sum to the positive "prevented loss"
 * that the sim reports as `deltaWei`.
 */
export function buildGuestInputs(event: CounterfactualReadyEvent): {
    event_id: number[];
    victim_protocol: number[];
    deltas: { key: number[]; delta_wei_be: number[] }[];
    claimed_delta_wei_be: number[];
    fork_block_hash: number[];
} {
    const victimLeaves = event.leaves.filter((l) => l.label.startsWith("victim."));
    const deltas = victimLeaves.map((l) => {
        // "prevented loss per leaf" = real - shadow. Positive = defense saved that much.
        const prevented = BigInt(l.realWei) - BigInt(l.shadowWei);
        return {
            key: sha256Bytes(l.label),
            delta_wei_be: int256ToBytes32(prevented),
        };
    });

    // Include fork block hash when available (Hybrid Approach A grounding).
    const forkBlockHashBytes =
        event.forkBlockHash && event.forkBlockHash !== `0x${"00".repeat(32)}`
            ? hexToBytes(event.forkBlockHash as `0x${string}`, 32)
            : new Array(32).fill(0);

    return {
        event_id: hexToBytes(event.eventId, 32),
        victim_protocol: hexToBytes(event.victimProtocol, 20),
        deltas,
        claimed_delta_wei_be: int256ToBytes32(BigInt(event.deltaWei)),
        fork_block_hash: forkBlockHashBytes,
    };
}

export async function startLedgerPublisher(cfg: {
    redisUrl: string;
    rpcUrl: string;
    addressesFile: string;
    proverKey: `0x${string}`;
    prove: ProveFn;
}): Promise<void> {
    const addresses = JSON.parse(readFileSync(cfg.addressesFile, "utf-8")) as Record<string, `0x${string}`>;

    const publisherRedis = new Redis(cfg.redisUrl);
    const minedRedis = new Redis(cfg.redisUrl);
    const readyRedis = new Redis(cfg.redisUrl);

    const streamPub = new StreamPublisher(publisherRedis);

    const realTxByEvent = new Map<string, `0x${string}`>();
    const recordedEvents = new Set<string>();

    const account = privateKeyToAccount(cfg.proverKey);
    const pub = createPublicClient({ transport: http(cfg.rpcUrl) });
    const wallet = createWalletClient({ account, transport: http(cfg.rpcUrl) });

    const minedConsumer = new StreamConsumer(minedRedis, {
        stream: "sentinel.defense.mined",
        group: "zk-prover-ledger-mined",
        consumerName: "zk-prover-ledger-mined-1",
        handler: async (msg) => {
            const data = msg.data as { eventId?: string; txHash?: `0x${string}` };
            if (data.eventId && data.txHash) {
                realTxByEvent.set(data.eventId, data.txHash);
            }
        },
    });

    const readyConsumer = new StreamConsumer(readyRedis, {
        stream: "sentinel.counterfactual.ready",
        group: "zk-prover-ledger-ready",
        consumerName: "zk-prover-ledger-ready-1",
        handler: async (msg) => {
            const data = msg.data as Partial<CounterfactualReadyEvent>;
            try {
                if (!data.eventId || !data.victimProtocol || !data.leaves) {
                    log.warn({ data }, "incomplete counterfactual.ready payload, skipping");
                    return;
                }
                if (recordedEvents.has(data.eventId)) {
                    log.debug({ eventId: data.eventId }, "already recorded, skipping");
                    return;
                }

                const realTx = realTxByEvent.get(data.eventId) ?? (("0x" + "00".repeat(32)) as `0x${string}`);

                const guestInputs = buildGuestInputs(data as CounterfactualReadyEvent);

                await streamPub.publish("sentinel.prover.started", {
                    schema: "ProofStartedEvent@1",
                    eventId: data.eventId,
                    circuit: "counterfactual-correctness",
                });

                const proved = await cfg.prove("counterfactual-correctness", guestInputs);

                // publicInputs = [eventId, counterfactualRoot, deltaWei, victim].
                const publicInputs = proved.publicInputs as `0x${string}`[];
                const guestRoot = publicInputs[1];
                const proofDigest = keccak256(proved.proof as `0x${string}`);

                const entry = {
                    eventId: data.eventId,
                    atBlock: BigInt(data.forkBlock ?? 0),
                    deltaWei: BigInt(data.deltaWei ?? "0"),
                    realTxHash: realTx,
                    counterfactualRoot: guestRoot,
                    proofDigest,
                    recordedAt: 0n,
                };

                const hash = await wallet.writeContract({
                    address: addresses.CounterfactualLedger,
                    abi: LEDGER_ABI,
                    functionName: "record",
                    args: [entry, proved.proof as `0x${string}`, publicInputs],
                    chain: null,
                });
                const receipt = await pub.waitForTransactionReceipt({ hash });

                recordedEvents.add(data.eventId);
                await streamPub.publish("sentinel.prover.finished", {
                    schema: "ProofFinishedEvent@1",
                    eventId: data.eventId,
                    circuit: "counterfactual-correctness",
                    status: "ok",
                });
                await streamPub.publish("sentinel.ledger.recorded", {
                    schema: "LedgerRecordedEvent@1",
                    eventId: data.eventId,
                    txHash: hash,
                    blockNumber: Number(receipt.blockNumber),
                    deltaWei: data.deltaWei,
                    counterfactualRoot: guestRoot,
                    proofDigest,
                });
                log.info(
                    {
                        eventId: data.eventId,
                        txHash: hash,
                        blockNumber: Number(receipt.blockNumber),
                        guestRoot,
                    },
                    "ledger.recorded",
                );
            } catch (err) {
                log.error({ err: String(err) }, "ledger_publisher failed");
                await streamPub.publish("sentinel.alerts", {
                    schema: "AlertEvent@1",
                    severity: "error",
                    message: `ledger_publisher: ${String(err)}`,
                });
            }
        },
    });

    await minedConsumer.start();
    await readyConsumer.start();

    log.info("ledger_publisher listening on sentinel.counterfactual.ready");
}
