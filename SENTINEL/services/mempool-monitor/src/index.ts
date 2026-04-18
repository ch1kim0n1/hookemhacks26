import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { StreamPublisher } from "@sentinel/stream-client";
import { JsonRpcProvider, type TransactionResponse, WebSocketProvider } from "ethers";
import Redis from "ioredis";
import { Counter, Histogram, collectDefaultMetrics, register } from "prom-client";
import { type MonitorConfig, type TxFeatures, extractFeatures } from "./features.js";
import { log } from "./logger.js";
import {
    STREAM_MEMPOOL_BLOCK,
    STREAM_MEMPOOL_PENDING,
    buildBlockEnvelope,
    buildPendingTxEnvelope,
} from "./mempool-payloads.js";
import { WS_RECONNECT_MAX_ATTEMPTS } from "./ws-config.js";

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

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:8545";
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const ADDRESSES_FILE = process.env.ADDRESSES_FILE ?? "../../config/addresses.local.json";

function loadConfig(): MonitorConfig {
    const raw = readFileSync(ADDRESSES_FILE, "utf-8");
    const addresses = JSON.parse(raw) as Record<string, string>;

    const lower = (s: string | undefined) => (s ?? "").toLowerCase();
    const providers = new Set<string>();
    if (addresses.FlashLoanProvider) providers.add(lower(addresses.FlashLoanProvider));

    const protocols = new Set<string>();
    if (addresses.VictimLendingPool) protocols.add(lower(addresses.VictimLendingPool));
    if (addresses.FlashLoanAttacker) protocols.add(lower(addresses.FlashLoanAttacker));

    return { flashLoanProviders: providers, protectedProtocols: protocols };
}

async function publishFeatures(streamPub: StreamPublisher, features: TxFeatures) {
    const start = Date.now();
    const payload = buildPendingTxEnvelope(features);
    await streamPub.publish(STREAM_MEMPOOL_PENDING, payload);
    eventsProcessed.inc({ service: "mempool-monitor", channel: STREAM_MEMPOOL_PENDING });
    latencyMs.observe({ service: "mempool-monitor", stage: "publish" }, Date.now() - start);
    log.info({ hash: features.hash, selector: features.selector, to: features.to }, "published pending tx");
}

async function handlePending(
    httpProvider: JsonRpcProvider,
    streamPub: StreamPublisher,
    cfg: MonitorConfig,
    txHash: string,
) {
    try {
        const tx: TransactionResponse | null = await httpProvider.getTransaction(txHash);
        if (!tx) return; // tx may have been mined/replaced before we saw it
        const features = extractFeatures(tx, cfg);
        await publishFeatures(streamPub, features);
    } catch (err) {
        errorsTotal.inc({ service: "mempool-monitor", kind: "handle_pending_error" });
        log.error({ err, txHash }, "handlePending failed");
    }
}

async function main() {
    const cfg = loadConfig();
    log.info(
        {
            flashLoanProviders: [...cfg.flashLoanProviders],
            protectedProtocols: [...cfg.protectedProtocols],
        },
        "mempool-monitor starting",
    );

    const httpProvider = new JsonRpcProvider(RPC_URL);
    const wsProvider = new WebSocketProvider(WS_URL);
    const redis = new Redis(REDIS_URL);
    const streamPub = new StreamPublisher(redis);

    wsProvider.on("pending", async (txHash: string) => {
        await handlePending(httpProvider, streamPub, cfg, txHash);
    });

    // Also publish on every new block so downstream can track head height.
    wsProvider.on("block", async (blockNumber: number) => {
        const payload = buildBlockEnvelope(blockNumber);
        await streamPub.publish(STREAM_MEMPOOL_BLOCK, payload);
    });

    // --- WS reconnect logic (Issue #38) ---
    wsProvider.on("error", (err: Error) => {
        log.error({ err: err.message }, "ws provider error");
    });

    // ethers v6 WebSocketProvider doesn't have built-in reconnect.
    // Best-effort reconnect wrapper: up to 5 attempts with exponential backoff.
    let reconnecting = false;
    const reconnect = async () => {
        if (reconnecting) return;
        reconnecting = true;
        log.info("attempting ws reconnect...");
        for (let attempt = 1; attempt <= WS_RECONNECT_MAX_ATTEMPTS; attempt++) {
            try {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
                await new Promise((r) => setTimeout(r, delay));
                const newWsProvider = new WebSocketProvider(WS_URL);
                newWsProvider.on("pending", async (txHash: string) => {
                    await handlePending(httpProvider, streamPub, cfg, txHash);
                });
                newWsProvider.on("block", async (blockNumber: number) => {
                    const payload = buildBlockEnvelope(blockNumber);
                    await streamPub.publish(STREAM_MEMPOOL_BLOCK, payload);
                });
                log.info({ attempt }, "ws reconnected");
                reconnecting = false;
                return;
            } catch (err) {
                log.error({ attempt, err }, "ws reconnect failed");
            }
        }
        log.error("ws reconnect exhausted all retries");
        reconnecting = false;
    };

    // Hook into the underlying WebSocket close event to trigger reconnect.
    (wsProvider as any).websocket?.addEventListener?.("close", () => {
        log.warn("ws provider disconnected");
        reconnect();
    });

    const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? 9001);
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
        log.info({ port: HEALTH_PORT }, "mempool-monitor health endpoint");
    });

    const shutdown = async () => {
        log.info("mempool-monitor shutting down");
        await wsProvider.destroy();
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
