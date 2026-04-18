import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { StreamConsumer, StreamPublisher } from "@sentinel/stream-client";
import Redis from "ioredis";
import { Counter, Histogram, collectDefaultMetrics, register } from "prom-client";
import { http, createPublicClient, parseAbi } from "viem";
import { log } from "./logger.js";

collectDefaultMetrics();

const eventsProcessed = new Counter({
    name: "sentinel_events_processed_total",
    help: "Total events processed",
    labelNames: ["service", "channel"],
});

const latencyMs = new Histogram({
    name: "sentinel_latency_ms",
    help: "Processing latency in milliseconds",
    labelNames: ["service", "stage"],
    buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
});

const errorsTotal = new Counter({
    name: "sentinel_errors_total",
    help: "Total errors",
    labelNames: ["service", "kind"],
});

import { diff, queryBalances } from "./delta.js";
import { type AnvilFork, type ForkOptions, spawnFork } from "./fork.js";
import { computeRoot } from "./merkle.js";
import { type ProtocolProfile, loadProfiles, matchProfile } from "./protocol-adapter.js";
import { replayAttack } from "./shadow.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
/** When true (default), wait for `sentinel.defense.mined` before Timeline A queries (doc 03). Set to "0" to run on `detection.confirmed` only (legacy / tests). */
const WAIT_FOR_DEFENSE_MINED = process.env.COUNTERFACTUAL_WAIT_DEFENSE !== "0";
const ADDRESSES_FILE = process.env.ADDRESSES_FILE ?? "../../config/addresses.local.json";
const PROFILE_FILE = process.env.PROFILE_FILE ?? "../../config/protocol-profiles/victim-lending-pool.json";
const PROFILES_DIR = process.env.PROFILES_DIR ?? "../../config/protocol-profiles";

// FlashLoanAttacker.owner = the ATTACKER key used by DeployLocal (Anvil
// account #5 = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc). This must
// match api-gateway's ATTACKER_KEY so shadow replay impersonates the
// same EOA that owns the attacker contract on main.
const ATTACKER_OWNER: `0x${string}` =
    (process.env.ATTACKER_OWNER as `0x${string}` | undefined) ?? "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";

interface Addresses {
    [k: string]: `0x${string}`;
}

// ProtocolProfile is imported from protocol-adapter; keep a local alias for
// the parts of this file that previously used the inline Profile type.
type Profile = ProtocolProfile;

interface PendingThreat {
    addresses: Addresses;
    profile: Profile;
}

/** eventId → threat context while we wait for defense tx to land on-chain. */
const pendingThreats = new Map<string, PendingThreat>();

const GET_RESERVES_ABI = parseAbi(["function getReserves() view returns (uint256, uint256)"]);
const PRICE_IMPACT_THRESHOLD_PCT = 1.0;

async function spawnForkWithRetry(opts: ForkOptions, maxAttempts = 2): Promise<AnvilFork> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await spawnFork(opts);
        } catch (err) {
            lastErr = err;
            if (attempt < maxAttempts) {
                log.warn({ attempt, err }, "fork spawn failed, retrying in 500ms");
                await new Promise((r) => setTimeout(r, 500));
            }
        }
    }
    throw lastErr;
}

async function onThreatConfirmed(
    addresses: Addresses,
    profile: Profile,
    publisher: StreamPublisher,
    event: { eventId: string },
): Promise<void> {
    // Price-impact check: fetch oracle reserves and skip sim if impact is negligible.
    const oracleAddr = addresses["OraclePair"] as `0x${string}` | undefined;
    if (oracleAddr) {
        try {
            const oracleClient = createPublicClient({ transport: http(RPC_URL) });
            const [reserve0, reserve1] = await oracleClient.readContract({
                address: oracleAddr,
                abi: GET_RESERVES_ABI,
                functionName: "getReserves",
            });
            if (reserve0 === 0n || reserve1 === 0n) {
                log.info({ eventId: event.eventId }, "oracle unseeded — skipping counterfactual sim");
                return;
            }
            // Estimate impact: proxy loan = 90% of reserve0 (typical flash-loan size).
            const loanAmount = (reserve0 * 9n) / 10n;
            const newReserve1 = (reserve0 * reserve1) / (reserve0 + loanAmount);
            const oldPrice = Number(reserve1) / Number(reserve0);
            const newPrice = Number(newReserve1) / Number(reserve0 + loanAmount);
            const deviationPct = oldPrice > 0 ? (Math.abs(newPrice - oldPrice) / oldPrice) * 100 : 0;
            if (deviationPct < PRICE_IMPACT_THRESHOLD_PCT) {
                log.info({ eventId: event.eventId, deviationPct }, "price impact below threshold — skipping sim");
                return;
            }
            log.info({ eventId: event.eventId, deviationPct }, "price impact check passed");
        } catch (err) {
            log.warn({ eventId: event.eventId, err }, "price-impact check failed, proceeding anyway");
        }
    }

    const main = createPublicClient({ transport: http(RPC_URL) });
    const currentBlock = await main.getBlockNumber();
    // Fork one block behind latest: this is the state before the
    // attacker's tx landed, which is exactly what we want for a clean
    // "WITHOUT SENTINEL" shadow timeline.
    const forkBlock = Number(currentBlock - 1n);

    // Fetch the fork block's hash to ground the proof in a real historical
    // block (Hybrid Approach A — doc 04 §CounterfactualCorrectness).
    let forkBlockHash: `0x${string}` = `0x${"00".repeat(32)}`;
    try {
        const block = await main.getBlock({ blockNumber: BigInt(forkBlock) });
        if (block.hash) forkBlockHash = block.hash;
    } catch (err) {
        log.warn({ forkBlock, err }, "could not fetch fork block hash; using zeros");
    }

    log.info(
        { eventId: event.eventId, forkBlock, forkBlockHash: forkBlockHash.slice(0, 12) + "…" },
        "spawning shadow fork",
    );

    const simStart = Date.now();
    const fork = await spawnForkWithRetry({
        forkUrl: RPC_URL,
        forkBlock,
        timeoutMs: 20000,
    });

    try {
        // 1. Replay the attacker call on the fork.
        const attackerContract = addresses[profile.attackerReplay.attackerAddressKey];
        const args = profile.attackerReplay.args.map((a) => {
            if (a.fromKey) return addresses[a.fromKey];
            if (a.literalHex) return BigInt(a.literalHex);
            throw new Error("unknown arg shape");
        });
        const callerAddress =
            profile.attackerReplay.callerKey === "FlashLoanAttackerOwner"
                ? ATTACKER_OWNER
                : (addresses[profile.attackerReplay.callerKey] as `0x${string}`);

        await replayAttack({
            forkRpc: fork.rpcUrl,
            callerAddress,
            attackerContract,
            method: profile.attackerReplay.method,
            args,
        });

        // 2. Query tracked balances on BOTH chains.
        const tracked = profile.trackedAddresses.map((t) => ({
            address: addresses[t.addressKey],
            label: t.label,
            token: addresses[t.tokenKey],
        }));
        const [real, shadow] = await Promise.all([
            queryBalances(RPC_URL, tracked),
            queryBalances(fork.rpcUrl, tracked),
        ]);

        // 3. Compute delta + merkle root.
        const { leaves, totalDeltaWei } = diff(real, shadow);
        const root = computeRoot(leaves);

        // 4. Publish. `victimProtocol` is emitted so downstream (ledger
        // publisher) can pass it as a guest input — on-chain it's bound
        // into the CounterfactualCorrectness journal as bytes32.
        const victimProtocol = addresses[profile.addressKey];
        const payload = {
            schema: "CounterfactualReadyEvent@1",
            emittedAt: new Date().toISOString(),
            eventId: event.eventId,
            deltaWei: totalDeltaWei.toString(),
            counterfactualRoot: root,
            victimProtocol,
            leaves,
            forkBlock,
            forkBlockHash,
        };
        await publisher.publish("sentinel.counterfactual.ready", payload);
        eventsProcessed.inc({ service: "counterfactual-sim", channel: "sentinel.counterfactual.ready" });
        latencyMs.observe({ service: "counterfactual-sim", stage: "sim_fork" }, Date.now() - simStart);
        log.info(
            {
                eventId: event.eventId,
                deltaWei: payload.deltaWei,
                root,
            },
            "published counterfactual",
        );
    } finally {
        await fork.dispose();
    }
}

async function main() {
    const addresses: Addresses = JSON.parse(readFileSync(ADDRESSES_FILE, "utf-8"));

    // Load all profiles from the profiles directory.
    const profiles = loadProfiles(PROFILES_DIR);

    // Also load the single-file profile for backward compatibility.
    let singleProfile: ProtocolProfile | undefined;
    if (PROFILE_FILE) {
        try {
            singleProfile = JSON.parse(readFileSync(PROFILE_FILE, "utf-8"));
        } catch {}
    }
    const allProfiles = singleProfile
        ? [singleProfile, ...profiles.filter((p) => p.protocolName !== singleProfile!.protocolName)]
        : profiles;

    log.info(
        { profileCount: allProfiles.length, names: allProfiles.map((p) => p.protocolName) },
        "loaded protocol profiles",
    );

    const redis = new Redis(REDIS_URL);
    const streamPub = new StreamPublisher(redis);
    const consumerRedis = new Redis(REDIS_URL);

    const onDetectionConfirmed = async (msg: { data: Record<string, unknown> }) => {
        const event = msg.data as { eventId?: string; victimProtocol?: string };
        if (!event.eventId) return;
        const matchedProfile = matchProfile(allProfiles, addresses, event.victimProtocol ?? "");
        if (!matchedProfile) {
            log.warn({ victimProtocol: event.victimProtocol }, "no matching profile for threat");
            return;
        }
        const eventId = event.eventId;
        if (WAIT_FOR_DEFENSE_MINED) {
            pendingThreats.set(eventId, { addresses, profile: matchedProfile });
            log.info({ eventId }, "buffered threat — waiting for sentinel.defense.mined");
            return;
        }
        try {
            await onThreatConfirmed(addresses, matchedProfile, streamPub, { eventId });
        } catch (err) {
            errorsTotal.inc({ service: "counterfactual-sim", kind: "sim_error" });
            throw err;
        }
    };

    const detectionConsumer = new StreamConsumer(consumerRedis, {
        stream: "sentinel.detection.confirmed",
        group: "counterfactual-sim",
        consumerName: `counterfactual-sim-${process.pid}`,
        handler: onDetectionConfirmed,
    });
    await detectionConsumer.start();

    let defenseConsumer: StreamConsumer | undefined;
    let defenseRedis: Redis | undefined;
    if (WAIT_FOR_DEFENSE_MINED) {
        defenseRedis = new Redis(REDIS_URL);
        defenseConsumer = new StreamConsumer(defenseRedis, {
            stream: "sentinel.defense.mined",
            group: "counterfactual-sim-defense",
            consumerName: `counterfactual-sim-defense-${process.pid}`,
            handler: async (msg) => {
                const data = msg.data as { eventId?: string };
                const eventId = data.eventId;
                if (!eventId) return;
                const pending = pendingThreats.get(eventId);
                if (!pending) {
                    log.warn({ eventId }, "defense.mined without matching detection.confirmed — skip");
                    return;
                }
                pendingThreats.delete(eventId);
                try {
                    await onThreatConfirmed(pending.addresses, pending.profile, streamPub, { eventId });
                } catch (err) {
                    errorsTotal.inc({ service: "counterfactual-sim", kind: "sim_error" });
                    throw err;
                }
            },
        });
        await defenseConsumer.start();
    }

    log.info({ waitForDefenseMined: WAIT_FOR_DEFENSE_MINED }, "counterfactual-sim (real fork) listening");

    const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? 9002);
    const healthServer = createServer(async (req, res) => {
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));
        } else if (req.url === "/metrics") {
            const metrics = await register.metrics();
            res.writeHead(200, { "Content-Type": register.contentType });
            res.end(metrics);
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    healthServer.listen(HEALTH_PORT, "0.0.0.0", () => {
        log.info({ port: HEALTH_PORT }, "counterfactual-sim health endpoint");
    });

    const shutdown = async () => {
        await detectionConsumer.stop();
        await defenseConsumer?.stop();
        await consumerRedis.quit();
        await defenseRedis?.quit();
        await redis.quit();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    log.error({ err }, "fatal");
    process.exit(1);
});
