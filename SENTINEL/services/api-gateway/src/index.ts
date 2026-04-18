import fastifyCors from "@fastify/cors";
import fastifyWs from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import Redis from "ioredis";
import { Counter, Histogram, collectDefaultMetrics, register } from "prom-client";

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
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { http, createWalletClient, encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { StreamConsumer, StreamPublisher } from "@sentinel/stream-client";
import { registerAuditHook, registerAuditRoutes } from "./audit.js";
import { AUTH_ENV_DEFAULTS, registerAuth } from "./auth.js";
import { type EventEnvelope, deriveTrustCues, redisChannelToKind } from "./cues.js";
import { getPool, runMigrations } from "./db.js";
import { registerErrorHandler } from "./error-handler.js";
import { log } from "./logger.js";
import { rbacHook } from "./rbac.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerChainRoutes } from "./routes/chains.js";
import { type ApprovalRecord, registerEvidenceRoutes } from "./routes/evidence.js";
import { registerEventsRoutes } from "./routes/events.js";
import { registerLedgerRoutes } from "./routes/ledger.js";
import { registerPolicyRoutes } from "./routes/policy.js";
import { registerTenantRoutes } from "./routes/tenants.js";
import { registerThreatRoutes } from "./routes/threats.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const ADDRESSES_FILE = process.env.ADDRESSES_FILE ?? "../../config/addresses.local.json";
const PORT = Number(process.env.PORT ?? 8080);
const WS_PORT = Number(process.env.WS_PORT ?? 8081);

// Anvil default account #5 (attacker / demo trigger).
const ATTACKER_KEY =
    (process.env.ATTACKER_KEY as `0x${string}` | undefined) ??
    "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";

interface Addresses {
    [key: string]: string;
}

const REQUIRED_ADDRESS_KEYS = [
    "CounterfactualLedger",
    "CounterfactualVerifier",
    "FlashLoanAttacker",
    "FlashLoanProvider",
    "OraclePair",
    "PauseController",
    "PolicyRegistry",
    "PolicyVerifier",
    "ThreatRegistry",
    "VictimLendingPool",
];
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function loadAddresses(): Addresses {
    let raw: string;
    try {
        raw = readFileSync(ADDRESSES_FILE, "utf-8");
    } catch (err) {
        throw new Error(
            `cannot read ADDRESSES_FILE=${ADDRESSES_FILE}: ${(err as Error).message}\n` +
                `  -> run: forge script contracts/script/DeployLocal.s.sol --rpc-url ${RPC_URL} --broadcast`,
        );
    }
    let parsed: Addresses;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`malformed JSON in ${ADDRESSES_FILE}: ${(err as Error).message}`);
    }
    const missing = REQUIRED_ADDRESS_KEYS.filter((k) => !parsed[k]);
    if (missing.length > 0) {
        throw new Error(
            `addresses file is stale/incomplete — missing: ${missing.join(", ")}\n` +
                `  -> redeploy with: forge script contracts/script/DeployLocal.s.sol`,
        );
    }
    const malformed = REQUIRED_ADDRESS_KEYS.filter((k) => !ADDRESS_REGEX.test(String(parsed[k])));
    if (malformed.length > 0) {
        throw new Error(`malformed address(es) in ${ADDRESSES_FILE}: ${malformed.join(", ")}`);
    }
    return parsed;
}

async function probeAddressesOnChain(addresses: Addresses, rpcUrl: string): Promise<void> {
    if (process.env.SKIP_ADDRESS_PROBE === "1") {
        log.info("SKIP_ADDRESS_PROBE=1 — not verifying on-chain bytecode");
        return;
    }
    const stale: string[] = [];
    for (const key of REQUIRED_ADDRESS_KEYS) {
        try {
            const r = await fetch(rpcUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_getCode",
                    params: [addresses[key], "latest"],
                }),
                signal: AbortSignal.timeout(3_000),
            });
            const j = (await r.json()) as { result?: string };
            if (!j.result || j.result === "0x" || j.result === "0x0") {
                stale.push(`${key}@${addresses[key]}`);
            }
        } catch (err) {
            log.warn({ err: (err as Error).message, key }, "address probe failed (RPC unreachable?); continuing");
            return;
        }
    }
    if (stale.length > 0) {
        throw new Error(
            `addresses.local.json is stale — no bytecode at: ${stale.join(", ")}\n` +
                `  -> redeploy contracts: forge script contracts/script/DeployLocal.s.sol --rpc-url ${rpcUrl} --broadcast`,
        );
    }
    log.info({ verified: REQUIRED_ADDRESS_KEYS.length }, "addresses verified on-chain");
}

const FIREHOSE_CHANNELS = [
    "sentinel.mempool.pending",
    "sentinel.mempool.block",
    "sentinel.detection.candidate",
    "sentinel.detection.confirmed",
    "sentinel.defense.submitted",
    "sentinel.defense.mined",
    "sentinel.defense.rejected",
    "sentinel.defense.pending_approval",
    "sentinel.defense.approval",
    "sentinel.counterfactual.ready",
    "sentinel.prover.started",
    "sentinel.prover.finished",
    "sentinel.ledger.recorded",
    "sentinel.alerts",
    "sentinel.training.telemetry",
    "sentinel.preemptive.signature",
    "sentinel.preemptive.executed",
    "sentinel.preemptive.alert",
    "sentinel.federation.sync",
];

const CHANNEL_TO_KINDS: Record<string, string[]> = {
    "events.all": [], // empty = receive everything
    "trust.collapse": [], // handled by deriveTrustCues, not kind-based
    "mempool.pending": ["PENDING_TX"],
    "defense.submitted": ["DEFENSE_SUBMITTED"],
    "defense.mined": ["DEFENSE_MINED"],
    "defense.approval": ["DEFENSE_PENDING_APPROVAL", "DEFENSE_APPROVAL"],
    "counterfactual.ready": ["COUNTERFACTUAL_READY"],
    "ledger.recorded": ["LEDGER_RECORDED"],
    "prover.progress": ["PROVER_STARTED", "PROVER_FINISHED"],
    "battlefield.tick": ["TRAINING_TELEMETRY"],
    "immunity.propagation": ["PREEMPTIVE_SIGNATURE", "PREEMPTIVE_EXECUTED", "PREEMPTIVE_ALERT", "FEDERATION_SYNC"],
};

const RECENT_EVENTS: EventEnvelope[] = [];
const MAX_RECENT = 500;

// Counterfactual trees are populated when `sentinel.counterfactual.ready`
// fires with a leaves[] payload (counterfactual-sim service).
const counterfactualTrees = new Map<string, unknown>();

// Approval records captured via POST /api/v1/approvals/:eventId/(approve|reject).
// Exported in the evidence bundle so auditors see who released a
// fail-closed-by-default defense action.
const approvalRecords = new Map<string, ApprovalRecord>();

function startFirehoseConsumers(
    redisUrl: string,
    handler: (channel: string, data: Record<string, unknown>) => void,
): void {
    for (const channel of FIREHOSE_CHANNELS) {
        const consumerRedis = new Redis(redisUrl);
        const consumer = new StreamConsumer(consumerRedis, {
            stream: channel,
            group: "api-gateway",
            consumerName: `api-gateway-${process.pid}`,
            handler: async (msg) => {
                handler(channel, msg.data as Record<string, unknown>);
            },
            blockMs: 2000,
        });
        consumer.start().catch((err) => {
            log.error({ err, channel }, "firehose consumer failed to start");
        });
    }
}

async function main() {
    const app = Fastify({ logger: false });
    await app.register(fastifyCors, { origin: true });
    await app.register(fastifyWs);

    // --- Standardized error format (before routes) ---
    registerErrorHandler(app);

    const addresses = loadAddresses();
    await probeAddressesOnChain(addresses, RPC_URL);

    // --- Wire auth middleware (before routes) ---
    await registerAuth(app, {
        jwtSecret: process.env.SENTINEL_JWT_SECRET ?? AUTH_ENV_DEFAULTS.jwtSecret,
        privateKeyPath: process.env.JWT_PRIVATE_KEY_PATH || undefined,
        publicKeyPath: process.env.JWT_PUBLIC_KEY_PATH || undefined,
        adminPassword: process.env.SENTINEL_ADMIN_PASSWORD ?? AUTH_ENV_DEFAULTS.adminPassword,
        demoToken: process.env.SENTINEL_DEMO_TOKEN ?? AUTH_ENV_DEFAULTS.demoToken,
    });

    // --- RBAC hook (must come after auth so req.user is already set) ---
    app.addHook("onRequest", rbacHook);

    // --- Audit hook (fire-and-forget, runs after response is sent) ---
    registerAuditHook(app);
    await registerAuditRoutes(app);

    // Run Postgres migrations
    const dbPool = getPool();
    await runMigrations(dbPool);

    // Register admin routes
    await registerTenantRoutes(app);

    // --- StreamPublisher for demo endpoints ---
    const pubRedis = new Redis(REDIS_URL);
    const streamPub = new StreamPublisher(pubRedis);

    const subscribers = new Set<{
        socket: any;
        channels: Set<string>;
    }>();

    // --- StreamConsumers feed the WS firehose ---
    startFirehoseConsumers(REDIS_URL, (channel, data) => {
        const _firehoseStart = Date.now();
        const envelope: EventEnvelope = {
            channel,
            messageId: randomUUID(),
            emittedAt: new Date().toISOString(),
            kind: redisChannelToKind(channel),
            data,
        };
        RECENT_EVENTS.push(envelope);
        if (RECENT_EVENTS.length > MAX_RECENT) RECENT_EVENTS.shift();
        eventsProcessed.inc({ service: "api-gateway", channel });

        if (envelope.kind === "COUNTERFACTUAL_READY") {
            const d = envelope.data as Record<string, unknown>;
            if (d.eventId && d.leaves) {
                counterfactualTrees.set(String(d.eventId), {
                    root: d.counterfactualRoot,
                    leaves: d.leaves,
                });
            }
        }

        const uiCues = deriveTrustCues(envelope);

        const broadcastMsg = JSON.stringify({
            op: "event",
            channel: "events.all",
            data: envelope,
        });
        for (const s of subscribers) {
            // events.all = send everything
            if (s.channels.has("events.all")) {
                try {
                    s.socket.send(broadcastMsg);
                } catch {
                    errorsTotal.inc({ service: "api-gateway", kind: "ws_send_error" });
                }
            }

            // Per-topic channels: check if this event's kind matches
            for (const [channel, kinds] of Object.entries(CHANNEL_TO_KINDS)) {
                if (channel === "events.all" || channel === "trust.collapse") continue;
                if (s.channels.has(channel) && kinds.includes(envelope.kind)) {
                    try {
                        s.socket.send(
                            JSON.stringify({
                                op: "event",
                                channel,
                                data: envelope,
                            }),
                        );
                    } catch {
                        errorsTotal.inc({ service: "api-gateway", kind: "ws_send_error" });
                    }
                }
            }

            // trust.collapse stays as-is (cue-based)
            for (const cue of uiCues) {
                if (s.channels.has("trust.collapse")) {
                    try {
                        s.socket.send(
                            JSON.stringify({
                                op: "event",
                                channel: "trust.collapse",
                                data: cue,
                            }),
                        );
                    } catch {
                        errorsTotal.inc({ service: "api-gateway", kind: "ws_send_error" });
                    }
                }
            }
        }
        latencyMs.observe({ service: "api-gateway", stage: "firehose_broadcast" }, Date.now() - _firehoseStart);
    });

    // --- REST routes ---
    app.get("/api/v1/health", async (req, reply) => {
        const services: Record<string, string> = {};
        const healthPorts: Record<string, number> = {
            "mempool-monitor": 9001,
            "counterfactual-sim": 9002,
            "detection-engine": 9003,
            "defense-agent": 9004,
            "zk-prover": 9100,
            "learning-loop": 9005,
        };

        // Check each service (best-effort, don't block)
        const checks = Object.entries(healthPorts).map(async ([name, port]) => {
            try {
                const res = await fetch(`http://${name}:${port}/health`, { signal: AbortSignal.timeout(2000) });
                services[name] = res.ok ? "up" : "down";
            } catch {
                // In non-compose mode, try localhost
                try {
                    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
                    services[name] = res.ok ? "up" : "down";
                } catch {
                    services[name] = "unknown";
                }
            }
        });
        await Promise.allSettled(checks);

        // Get block height
        let blockHeight = 0;
        try {
            const res = await fetch(RPC_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
            });
            const data = (await res.json()) as any;
            blockHeight = Number.parseInt(data.result, 16);
        } catch {}

        const allUp = Object.values(services).every((s) => s === "up" || s === "unknown");
        if (!allUp) {
            reply.code(503);
        }

        return {
            status: allUp ? "ok" : "degraded",
            services,
            blockHeight,
            redis: "connected", // simplified
            rpc: RPC_URL,
            addresses: Object.keys(addresses),
        };
    });

    app.get("/metrics", async (_, reply) => {
        reply.header("Content-Type", register.contentType);
        return register.metrics();
    });

    app.get<{ Querystring: { limit?: string; cursor?: string } }>("/api/v1/events", async (req) => {
        const limit = Math.min(Number.parseInt(req.query.limit ?? "50", 10), 200);
        const cursor = req.query.cursor;

        let startIdx = 0;
        if (cursor) {
            const idx = RECENT_EVENTS.findIndex((e) => e.messageId === cursor);
            if (idx >= 0) startIdx = idx + 1;
        }

        const page = RECENT_EVENTS.slice(startIdx, startIdx + limit);
        const nextCursor =
            page.length === limit && startIdx + limit < RECENT_EVENTS.length ? page[page.length - 1].messageId : null;

        return { events: page, nextCursor, total: RECENT_EVENTS.length };
    });

    app.get("/api/v1/addresses", async () => addresses);

    await registerPolicyRoutes(app, addresses);
    await registerLedgerRoutes(app, addresses, counterfactualTrees);
    await registerEventsRoutes(app, RECENT_EVENTS);
    await registerEvidenceRoutes(app, addresses, RECENT_EVENTS, counterfactualTrees, approvalRecords);
    await registerApprovalRoutes(app, streamPub, approvalRecords);
    await registerThreatRoutes(app, RPC_URL, addresses);

    const CONFIG_DIR = process.env.CONFIG_DIR ?? join(dirname(ADDRESSES_FILE), ".");
    const chains = await registerChainRoutes(app, CONFIG_DIR);

    // Trigger demo scenario A: submits FlashLoanAttacker.attack(...) via RPC.
    app.post("/api/v1/demo/replay-scenario", async () => {
        const attacker = addresses.FlashLoanAttacker as `0x${string}`;
        const flashProvider = addresses.FlashLoanProvider as `0x${string}`;
        if (!attacker || !flashProvider) {
            return { error: "addresses not populated" };
        }
        const loanWeth = 900n * 10n ** 18n;
        const account = privateKeyToAccount(ATTACKER_KEY);
        const wallet = createWalletClient({
            account,
            transport: http(RPC_URL),
        });

        const abi = parseAbi(["function attack(address flashLoanProvider, uint256 loanWeth)"]);
        const data = encodeFunctionData({
            abi,
            functionName: "attack",
            args: [flashProvider, loanWeth],
        });

        try {
            const hash = await wallet.sendTransaction({
                to: attacker,
                data,
                chain: null,
            });
            log.info({ hash }, "demo scenario triggered");
            await streamPub.publish("sentinel.alerts", {
                schema: "AlertEvent@1",
                severity: "info",
                message: "demo scenario triggered",
                txHash: hash,
            });
            return { replayStarted: true, txHash: hash };
        } catch (err: any) {
            log.error({ err: err.message }, "replay-scenario failed");
            return { replayStarted: false, error: err.message };
        }
    });

    // Preemptive-strike demo: seeds a confirmed detection into the stream so
    // the preemptive-strike service propagates a signature (ThreatRegistry +
    // WS fan-out) and seeds matcher patterns across the federation. Then it
    // replays the attacker transaction so the mempool path fires and the
    // pause lands before the attack contract executes.
    app.post("/api/v1/demo/preemptive", async () => {
        const attacker = addresses.FlashLoanAttacker as `0x${string}` | undefined;
        const flashProvider = addresses.FlashLoanProvider as `0x${string}` | undefined;
        const victim = addresses.VictimLendingPool as `0x${string}` | undefined;
        if (!attacker || !flashProvider || !victim) {
            return { error: "addresses not populated — run DeployLocal first" };
        }

        const eventId = `0x${randomUUID().replace(/-/g, "")}${"00".repeat(8)}`;
        await streamPub.publish("sentinel.detection.confirmed", {
            schema: "ThreatConfirmedEvent@1",
            eventId,
            confidence: 9800,
            pattern: "FLASH_LOAN_ORACLE_MANIP",
            attackerAddresses: [attacker],
            victimProtocol: victim,
            triggeringTxHashes: [],
            observedAtBlock: 0,
            timestamp: new Date().toISOString(),
            note: "preemptive-strike demo: cross-federation signature seed",
        });

        // Now replay the attacker tx so the mempool-matcher path also fires.
        const loanWeth = 900n * 10n ** 18n;
        const account = privateKeyToAccount(ATTACKER_KEY);
        const wallet = createWalletClient({ account, transport: http(RPC_URL) });
        const abi = parseAbi(["function attack(address flashLoanProvider, uint256 loanWeth)"]);
        const data = encodeFunctionData({ abi, functionName: "attack", args: [flashProvider, loanWeth] });

        try {
            const hash = await wallet.sendTransaction({ to: attacker, data, chain: null });
            await streamPub.publish("sentinel.alerts", {
                schema: "AlertEvent@1",
                severity: "info",
                message: "preemptive demo triggered",
                eventId,
                txHash: hash,
            });
            return { preemptive: true, eventId, triggerTx: hash };
        } catch (err: any) {
            log.error({ err: err.message }, "preemptive demo failed");
            return { preemptive: false, eventId, error: err.message };
        }
    });

    // Generic launcher for demo/attacker.py scenarios. Spawns the Python
    // process which signs + broadcasts real txs (mode=real), or falls back
    // to Redis-injected synthetic txs (mode=auto). mempool-monitor picks
    // them up from the same stream every other path uses.
    const DEMO_SCENARIOS = new Set([
        "blitz",
        "recon",
        "stealth",
        "sandwich",
        "pingflood",
        "dust",
        "reentrant",
        "routine",
    ]);
    const REPO_ROOT = resolve(dirname(ADDRESSES_FILE), "..");
    let scenarioBusy = false;
    app.post<{ Params: { name: string } }>("/api/v1/demo/scenario/:name", async (req) => {
        const name = req.params.name;
        if (!DEMO_SCENARIOS.has(name)) {
            return { scenarioStarted: false, error: `unknown scenario: ${name}` };
        }
        if (scenarioBusy) {
            return { scenarioStarted: false, error: "another scenario is already running" };
        }
        scenarioBusy = true;
        const runId = randomUUID();
        const args = [
            "demo/attacker.py",
            name,
            "--mode",
            "auto",
            "--no-boot",
            "--rpc-url",
            RPC_URL,
            "--redis-url",
            REDIS_URL,
            "--addresses-file",
            ADDRESSES_FILE,
        ];
        const proc = spawn("python3", args, {
            cwd: REPO_ROOT,
            env: { ...process.env, PYTHONUNBUFFERED: "1" },
            stdio: ["ignore", "pipe", "pipe"],
        });
        proc.stdout.on("data", (d) => log.info({ runId, name, line: d.toString().trimEnd() }, "scenario stdout"));
        proc.stderr.on("data", (d) => log.warn({ runId, name, line: d.toString().trimEnd() }, "scenario stderr"));
        proc.on("error", (err) => {
            log.error({ runId, name, err: err.message }, "scenario spawn failed");
            scenarioBusy = false;
        });
        proc.on("exit", (code) => {
            log.info({ runId, name, code }, "scenario process exited");
            scenarioBusy = false;
        });
        await streamPub.publish("sentinel.alerts", {
            schema: "AlertEvent@1",
            severity: "info",
            message: `demo scenario '${name}' launched`,
            runId,
        });
        return { scenarioStarted: true, scenario: name, runId };
    });

    // Scenario B: inject a malicious instruction with an unknown pattern.
    app.post("/api/v1/demo/inject-instruction", async () => {
        const eventId = `0x${randomUUID().replace(/-/g, "")}${"00".repeat(8)}`;
        const payload = {
            schema: "ThreatConfirmedEvent@1",
            eventId,
            confidence: 10000,
            pattern: "OPERATOR_OVERRIDE",
            attackerAddresses: [],
            victimProtocol: addresses.VictimLendingPool,
            triggeringTxHashes: [],
            observedAtBlock: 0,
            timestamp: new Date().toISOString(),
            note: "injected by /demo/inject-instruction",
        };
        await streamPub.publish("sentinel.detection.confirmed", payload);
        return { eventId, submitted: true };
    });

    // Admin snapshot endpoint
    app.post("/api/v1/admin/snapshot", async () => {
        const res = await fetch(RPC_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "evm_snapshot",
                params: [],
                id: 1,
            }),
        });
        const json = (await res.json()) as any;
        const snapshotId = json.result;
        const snapshotPath = join(dirname(ADDRESSES_FILE), "anvil-snapshot.json");
        writeFileSync(
            snapshotPath,
            JSON.stringify({
                snapshotId,
                timestamp: new Date().toISOString(),
            }),
        );
        return { snapshotId };
    });

    // --- WebSocket at /ws ---
    app.register(async (wsApp: FastifyInstance) => {
        wsApp.get("/ws", { websocket: true }, (socket) => {
            const wsSocket = (socket as any).socket ?? socket;
            const entry = { socket: wsSocket, channels: new Set<string>() };
            subscribers.add(entry);
            log.info("ws client connected");

            let helloReceived = false;
            const helloTimeout = setTimeout(() => {
                if (!helloReceived) {
                    // Backward compat: send welcome anyway after 5s
                    wsSocket.send(
                        JSON.stringify({
                            op: "welcome",
                            serverTime: new Date().toISOString(),
                            subscriptionsAvailable: Object.keys(CHANNEL_TO_KINDS),
                            note: "no hello received, using default version",
                        }),
                    );
                }
            }, 5000);

            wsSocket.on("message", (buf: any) => {
                let msg: any;
                try {
                    msg = JSON.parse(buf.toString());
                } catch {
                    return;
                }

                if (msg.op === "hello" && !helloReceived) {
                    helloReceived = true;
                    clearTimeout(helloTimeout);
                    const version = msg.version ?? "1.0";
                    if (version !== "1.0") {
                        wsSocket.send(
                            JSON.stringify({
                                op: "error",
                                code: "VERSION_UNSUPPORTED",
                                message: `Version ${version} not supported`,
                            }),
                        );
                        wsSocket.close();
                        return;
                    }
                    wsSocket.send(
                        JSON.stringify({
                            op: "welcome",
                            serverTime: new Date().toISOString(),
                            version: "1.0",
                            subscriptionsAvailable: Object.keys(CHANNEL_TO_KINDS),
                        }),
                    );
                    return;
                }

                if (msg.op === "subscribe" && msg.channel) {
                    entry.channels.add(msg.channel);
                    wsSocket.send(
                        JSON.stringify({
                            op: "subscribed",
                            channel: msg.channel,
                        }),
                    );
                } else if (msg.op === "unsubscribe" && msg.channel) {
                    entry.channels.delete(msg.channel);
                    wsSocket.send(
                        JSON.stringify({
                            op: "unsubscribed",
                            channel: msg.channel,
                        }),
                    );
                } else if (msg.op === "ping") {
                    wsSocket.send(JSON.stringify({ op: "pong", ts: Date.now() }));
                }
            });

            wsSocket.on("close", () => {
                clearTimeout(helloTimeout);
                subscribers.delete(entry);
                log.info("ws client disconnected");
            });
        });
    });

    await app.listen({ port: PORT, host: "0.0.0.0" });
    log.info({ port: PORT }, "api-gateway REST listening");

    if (WS_PORT !== PORT) {
        const wsApp = Fastify({ logger: false });
        await wsApp.register(fastifyCors, { origin: true });
        await wsApp.register(fastifyWs);
        wsApp.register(async (w) => {
            w.get("/ws", { websocket: true }, (socket) => {
                const wsSocket = (socket as any).socket ?? socket;
                const entry = {
                    socket: wsSocket,
                    channels: new Set<string>(),
                };
                subscribers.add(entry);

                let helloReceived = false;
                const helloTimeout = setTimeout(() => {
                    if (!helloReceived) {
                        // Backward compat: send welcome anyway after 5s
                        wsSocket.send(
                            JSON.stringify({
                                op: "welcome",
                                serverTime: new Date().toISOString(),
                                subscriptionsAvailable: Object.keys(CHANNEL_TO_KINDS),
                                note: "no hello received, using default version",
                            }),
                        );
                    }
                }, 5000);

                wsSocket.on("message", (buf: any) => {
                    let msg: any;
                    try {
                        msg = JSON.parse(buf.toString());
                    } catch {
                        return;
                    }

                    if (msg.op === "hello" && !helloReceived) {
                        helloReceived = true;
                        clearTimeout(helloTimeout);
                        const version = msg.version ?? "1.0";
                        if (version !== "1.0") {
                            wsSocket.send(
                                JSON.stringify({
                                    op: "error",
                                    code: "VERSION_UNSUPPORTED",
                                    message: `Version ${version} not supported`,
                                }),
                            );
                            wsSocket.close();
                            return;
                        }
                        wsSocket.send(
                            JSON.stringify({
                                op: "welcome",
                                serverTime: new Date().toISOString(),
                                version: "1.0",
                                subscriptionsAvailable: Object.keys(CHANNEL_TO_KINDS),
                            }),
                        );
                        return;
                    }

                    if (msg.op === "subscribe" && msg.channel) {
                        entry.channels.add(msg.channel);
                        wsSocket.send(
                            JSON.stringify({
                                op: "subscribed",
                                channel: msg.channel,
                            }),
                        );
                    } else if (msg.op === "unsubscribe" && msg.channel) {
                        entry.channels.delete(msg.channel);
                        wsSocket.send(
                            JSON.stringify({
                                op: "unsubscribed",
                                channel: msg.channel,
                            }),
                        );
                    } else if (msg.op === "ping") {
                        wsSocket.send(JSON.stringify({ op: "pong", ts: Date.now() }));
                    }
                });
                wsSocket.on("close", () => {
                    clearTimeout(helloTimeout);
                    subscribers.delete(entry);
                });
            });
        });
        await wsApp.listen({ port: WS_PORT, host: "0.0.0.0" });
        log.info({ port: WS_PORT }, "api-gateway WS listening on separate port");
    }

    const shutdown = async () => {
        await pubRedis.quit();
        await app.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    log.error({ err }, "fatal");
    process.exit(1);
});
