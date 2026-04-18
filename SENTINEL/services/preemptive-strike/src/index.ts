import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { StreamConsumer, StreamPublisher } from "@sentinel/stream-client";
import { Redis } from "ioredis";
import { collectDefaultMetrics, register } from "prom-client";
import { type Hex, toFunctionSelector } from "viem";
import { log } from "./logger.js";
import { MempoolMatcher } from "./mempool-matcher.js";
import { SignaturePublisher } from "./signature-publisher.js";
import { StrikeExecutor } from "./strike-executor.js";

collectDefaultMetrics();

const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? 9006);

/**
 * Dedup: if we pre-emptively paused a protocol within this window,
 * don't fire again. Prevents flooding on rapid replays.
 */
const PREEMPTIVE_DEDUP_MS = 30_000;

/** `attack(address,uint256)` — the selector FlashLoanAttacker.attack() exposes. */
const ATTACK_SELECTOR = toFunctionSelector("attack(address,uint256)");

async function main() {
    // Config
    const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
    const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    const addressesPath = process.env.ADDRESSES_FILE ?? "../../config/addresses.local.json";
    const operatorKey = (process.env.STRIKE_OPERATOR_KEY ??
        "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a") as Hex; // Anvil #4

    const addresses = JSON.parse(readFileSync(addressesPath, "utf-8"));
    const redis = new Redis(redisUrl);
    const streamPub = new StreamPublisher(redis);

    // Components
    const sigPublisher = new SignaturePublisher(rpcUrl, addresses.ThreatRegistry as Hex, operatorKey);
    const matcher = new MempoolMatcher();
    const executor = new StrikeExecutor(rpcUrl, addresses.PauseController as Hex, operatorKey, streamPub);

    // Health + metrics — hoisted after matcher so /health can report pattern count.
    const healthServer = createServer(async (req, res) => {
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    status: "ok",
                    service: "preemptive-strike",
                    patterns: matcher.patternCount,
                    publishedSignatures: sigPublisher.publishedCount,
                }),
            );
        } else if (req.url === "/metrics") {
            const metrics = await register.metrics();
            res.writeHead(200, { "Content-Type": register.contentType });
            res.end(metrics);
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    healthServer.listen(HEALTH_PORT, "0.0.0.0");
    log.info({ port: HEALTH_PORT }, "preemptive-strike health/metrics endpoint");

    // Dedup: maps target protocol (lowercase) → last preemptive pause timestamp (ms).
    const recentPauses = new Map<string, number>();

    // --- Startup: seed pre-emptive pattern from known config ---
    // We know the attack contract and selector at deploy time, so we don't need
    // to wait for training loop output to start protecting the protocol.
    if (addresses.FlashLoanAttacker && addresses.VictimLendingPool) {
        matcher.addAttackerPattern(addresses.FlashLoanAttacker, ATTACK_SELECTOR, addresses.VictimLendingPool);
        log.info(
            { attacker: addresses.FlashLoanAttacker, selector: ATTACK_SELECTOR, target: addresses.VictimLendingPool },
            "pre-emptive pattern seeded from config",
        );
    }

    /** Derive + publish a signature, then broadcast a signature event to the firehose. */
    async function propagateSignature(args: {
        pattern: string;
        victimProtocol: string;
        generation: number;
        origin: string;
    }) {
        const sig = sigPublisher.deriveSignature(args);
        const onChainTx = await sigPublisher.publishOnChain(sig);
        await streamPub.publish("sentinel.preemptive.signature", {
            schema: "SignaturePublishedEvent@1",
            signatureHash: sig.signatureHash,
            pattern: sig.pattern,
            generation: sig.sourceGeneration,
            origin: args.origin,
            onChainTx: onChainTx ?? null,
            timestamp: new Date().toISOString(),
        });
        return sig;
    }

    // Subscribe to training telemetry — when a generation completes with
    // breached variants, derive and publish threat signatures for future patterns.
    const trainingConsumer = new StreamConsumer(new Redis(redisUrl), {
        stream: "sentinel.training.telemetry",
        group: "preemptive-strike",
        consumerName: `strike-training-${process.pid}`,
        handler: async (msg) => {
            const data = msg.data as {
                type?: string;
                breached?: number;
                generation?: number;
                data?: { breached?: number };
            };
            const breached = data.breached ?? (data.data as { breached?: number } | undefined)?.breached ?? 0;
            if (data.type === "generation_complete" && breached > 0) {
                await propagateSignature({
                    pattern: "FLASH_LOAN_ORACLE_MANIP",
                    victimProtocol: addresses.VictimLendingPool ?? "",
                    generation: data.generation ?? 0,
                    origin: "training",
                });
                matcher.addAttackerPattern(
                    addresses.FlashLoanAttacker ?? "",
                    ATTACK_SELECTOR,
                    addresses.VictimLendingPool ?? "",
                );
            }
        },
    });

    // Subscribe to confirmed detections — when the main detection pipeline
    // declares a threat, propagate the signature across the federation so
    // sibling protocols are immunized before the same pattern lands on them.
    const detectionConsumer = new StreamConsumer(new Redis(redisUrl), {
        stream: "sentinel.detection.confirmed",
        group: "preemptive-strike",
        consumerName: `strike-detection-${process.pid}`,
        handler: async (msg) => {
            const d = msg.data as {
                pattern?: string;
                victimProtocol?: string;
                attackerAddresses?: string[];
                observedAtBlock?: number;
                eventId?: string;
            };
            if (!d.pattern) return;

            const victim = d.victimProtocol ?? addresses.VictimLendingPool ?? "";
            await propagateSignature({
                pattern: d.pattern,
                victimProtocol: victim,
                generation: d.observedAtBlock ?? 0,
                origin: "detection",
            });

            // Seed matcher with any attacker addresses reported by detection,
            // so the same address trying to repeat the attack is caught preemptively.
            for (const attacker of d.attackerAddresses ?? []) {
                if (!attacker) continue;
                matcher.addAttackerPattern(attacker, ATTACK_SELECTOR, victim);
            }

            log.info(
                { pattern: d.pattern, victim, eventId: d.eventId, attackers: d.attackerAddresses?.length ?? 0 },
                "preemptive: seeded patterns from confirmed detection",
            );
        },
    });

    // Subscribe to mempool events — check for threat matches.
    const mempoolConsumer = new StreamConsumer(new Redis(redisUrl), {
        stream: "sentinel.mempool.pending",
        group: "preemptive-strike",
        consumerName: `strike-mempool-${process.pid}`,
        handler: async (msg) => {
            const tx = (msg.data as { tx?: { to?: string; data?: string; hash?: string } })?.tx;
            if (!tx?.to || !tx?.hash) return;

            const match = matcher.matchTransaction({
                to: tx.to,
                data: tx.data ?? "0x",
                hash: tx.hash,
            });
            if (!match) return;

            // Dedup: skip if we already fired for this target recently.
            const targetKey = match.target.toLowerCase();
            const lastPause = recentPauses.get(targetKey);
            if (lastPause && Date.now() - lastPause < PREEMPTIVE_DEDUP_MS) {
                log.debug({ target: match.target, msSinceLast: Date.now() - lastPause }, "preemptive strike throttled");
                return;
            }
            recentPauses.set(targetKey, Date.now());

            await executor.executePreemptivePause(match.target as Hex, match.signatureHash, match.txHash);
        },
    });

    await trainingConsumer.start();
    await detectionConsumer.start();
    await mempoolConsumer.start();
    log.info({ attackSelector: ATTACK_SELECTOR, patterns: matcher.patternCount }, "preemptive-strike-engine listening");

    const shutdown = () => {
        trainingConsumer.stop();
        detectionConsumer.stop();
        mempoolConsumer.stop();
        healthServer.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    log.error({ err }, "fatal");
    process.exit(1);
});
