import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { collectDefaultMetrics, register } from "prom-client";
import { log } from "./logger.js";
import { TrainingOrchestrator } from "./orchestrator.js";
import type { TrainingConfig } from "./types.js";

collectDefaultMetrics();

const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? 9005);

async function main() {
    // Health + metrics endpoint
    const healthServer = createServer(async (req, res) => {
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", service: "learning-loop" }));
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
        log.info({ port: HEALTH_PORT }, "learning-loop health/metrics endpoint");
    });

    const config: TrainingConfig = {
        populationSize: Number(process.env.POPULATION_SIZE ?? 20),
        winRateThreshold: Number(process.env.WIN_RATE_THRESHOLD ?? 0.95),
        maxGenerations: Number(process.env.MAX_GENERATIONS ?? 50),
        generationDelayMs: Number(process.env.GENERATION_DELAY_MS ?? 2000),
        rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
        redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
        policyPath: process.env.POLICY_PATH ?? "../../config/policy.json",
        addressesPath: process.env.ADDRESSES_FILE ?? "../../config/addresses.local.json",
        // On-chain policy update config (optional — skipped if not set)
        policyRegistryAddress: process.env.POLICY_REGISTRY_ADDRESS,
        operatorKey:
            process.env.LEARNING_LOOP_KEY ?? "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    };

    const orchestrator = new TrainingOrchestrator(config);

    // Load addresses
    try {
        const addresses = JSON.parse(readFileSync(config.addressesPath, "utf-8"));
        orchestrator.setAddresses(addresses);
    } catch (err) {
        log.warn({ err }, "Could not load addresses — Red agent will use empty addresses");
    }

    // Start training (non-blocking)
    orchestrator.run().catch((err) => {
        log.error({ err }, "training loop failed");
    });

    log.info({ config: { ...config, redisUrl: "***" } }, "learning-loop started");

    // Graceful shutdown
    const shutdown = () => {
        orchestrator.stop().finally(() => {
            healthServer.close();
            process.exit(0);
        });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    log.error({ err }, "fatal");
    process.exit(1);
});
