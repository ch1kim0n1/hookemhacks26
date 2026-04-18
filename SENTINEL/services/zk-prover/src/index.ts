// zk-prover
//
// HTTP surface over the Rust prove_* bins. All endpoints share one
// two-tier cache (in-memory + Postgres). The `ledger_publisher` started
// here shares the same cache so pre-warmed proofs are hot on both paths.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { Counter, Histogram, collectDefaultMetrics, register } from "prom-client";
import { startLedgerPublisher } from "./ledger_publisher.js";
import { log } from "./logger.js";
import { type Circuit, ProofCache } from "./proof-cache.js";
import { BINS, makeProver } from "./prover.js";

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
    buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 15_000, 60_000],
});

const errorsTotal = new Counter({
    name: "sentinel_errors_total",
    help: "Total errors",
    labelNames: ["service", "kind"],
});

const PORT = Number(process.env.PORT ?? 9100);

async function main() {
    const app = Fastify({ logger: false });
    const cache = new ProofCache(process.env.POSTGRES_URL);
    const prove = makeProver(cache);

    const proverMode = process.env.BONSAI_API_KEY ? "bonsai" : "local";
    const devMode = (process.env.RISC0_DEV_MODE ?? "0") === "1";

    app.get("/health", async () => ({
        status: "ok",
        bins: BINS,
        cacheSizeL1: cache.l1Size,
        cacheL2: cache.hasL2 ? "postgres" : "disabled",
        proverMode,
        devMode,
    }));

    app.get("/metrics", async (_, reply) => {
        reply.header("Content-Type", register.contentType);
        return register.metrics();
    });

    function endpoint(circuit: Circuit) {
        return async (req: { body: unknown }, reply: { code: (n: number) => void }) => {
            const start = Date.now();
            try {
                const result = await prove(circuit, req.body);
                eventsProcessed.inc({ service: "zk-prover", channel: `prove.${circuit}` });
                latencyMs.observe({ service: "zk-prover", stage: circuit }, Date.now() - start);
                return result;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                errorsTotal.inc({ service: "zk-prover", kind: "prove_error" });
                log.error({ err: msg, circuit }, "prove failed");
                reply.code(422);
                return { error: msg };
            }
        };
    }

    app.post<{ Body: unknown }>("/prove/policy", endpoint("policy-compliance"));
    app.post<{ Body: unknown }>("/prove/counterfactual", endpoint("counterfactual-correctness"));
    app.post<{ Body: unknown }>("/prove/learning", endpoint("learning-correctness"));

    app.get<{ Params: { inputHash: string }; Querystring: { circuit?: Circuit } }>(
        "/cache/:inputHash",
        async (req, reply) => {
            const circuit = (req.query.circuit ?? "policy-compliance") as Circuit;
            const hit = await cache.get(circuit, req.params.inputHash);
            if (!hit) {
                reply.code(404);
                return { error: "not found" };
            }
            return hit;
        },
    );

    const PROVER_KEY =
        (process.env.PROVER_KEY as `0x${string}` | undefined) ??
        "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"; // Anvil acct #2
    try {
        await startLedgerPublisher({
            redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
            rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
            addressesFile: process.env.ADDRESSES_FILE ?? "../../config/addresses.local.json",
            proverKey: PROVER_KEY,
            prove,
        });
    } catch (err) {
        log.error({ err: String(err) }, "ledger_publisher did not start");
    }

    await app.listen({ port: PORT, host: "0.0.0.0" });
    log.info({ port: PORT, proverMode, devMode, hasL2: cache.hasL2 }, "zk-prover listening");
}

main().catch((err) => {
    log.error({ err }, "fatal");
    process.exit(1);
});
