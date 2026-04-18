import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock ioredis so tests don't need a real Redis instance
vi.mock("ioredis", () => {
    const RedisMock = vi.fn().mockImplementation(() => ({
        xadd: vi.fn().mockResolvedValue("1-0"),
        disconnect: vi.fn(),
        quit: vi.fn().mockResolvedValue("OK"),
    }));
    return { Redis: RedisMock, default: RedisMock };
});

import { TrainingOrchestrator } from "./orchestrator.js";
import type { TrainingConfig } from "./types.js";

function makeTempConfig(): TrainingConfig {
    const dir = mkdtempSync(join(tmpdir(), "orch-test-"));
    const policyPath = join(dir, "policy.json");
    writeFileSync(
        policyPath,
        JSON.stringify({
            version: "1.0",
            rules: [
                {
                    pattern: "FLASH_LOAN_ORACLE_MANIP",
                    action: "Pause",
                    params: {
                        minLoanWei: "500000000000000000000", // 500 ETH
                        maxPriceDeviation: 3.0,
                    },
                },
            ],
            responseBudgetMs: 5000,
        }),
    );
    return {
        populationSize: 5,
        winRateThreshold: 0.8,
        maxGenerations: 3,
        generationDelayMs: 100,
        rpcUrl: "http://localhost:8545",
        redisUrl: "redis://localhost:6379",
        policyPath,
        addressesPath: "",
    };
}

describe("TrainingOrchestrator", () => {
    it("runs multiple generations and stops", async () => {
        const config = makeTempConfig();
        const orchestrator = new TrainingOrchestrator(config);
        orchestrator.setAddresses({
            FlashLoanProvider: "0x1111111111111111111111111111111111111111",
            VictimLendingPool: "0x2222222222222222222222222222222222222222",
        });

        // Run — should complete within maxGenerations
        await orchestrator.run();
        expect(orchestrator.isRunning).toBe(false);
    }, 30000); // generous timeout

    it("can be stopped mid-training", async () => {
        const config = makeTempConfig();
        config.maxGenerations = 100;
        config.generationDelayMs = 500;
        const orchestrator = new TrainingOrchestrator(config);
        orchestrator.setAddresses({
            FlashLoanProvider: "0x1111111111111111111111111111111111111111",
            VictimLendingPool: "0x2222222222222222222222222222222222222222",
        });

        const runPromise = orchestrator.run();
        await new Promise((r) => setTimeout(r, 1500));
        await orchestrator.stop();
        await runPromise;
        expect(orchestrator.isRunning).toBe(false);
    }, 15000);
});
