import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { BlueAgent } from "./blue-agent.js";
import type { AttackVariant, EvalResult } from "./types.js";

function makeTempPolicy(policy: Record<string, any>): string {
    const dir = mkdtempSync(join(tmpdir(), "blue-test-"));
    const path = join(dir, "policy.json");
    writeFileSync(path, JSON.stringify(policy));
    return path;
}

const BASE_POLICY = {
    version: "1.0",
    rules: [
        {
            pattern: "FLASH_LOAN_ORACLE_MANIP",
            action: "Pause",
            params: {
                minLoanWei: "1000000000000000000000", // 1000 ETH
                maxPriceDeviation: 5.0,
            },
        },
    ],
    responseBudgetMs: 5000,
};

const VARIANTS: AttackVariant[] = [
    {
        id: "v1",
        loanAmountWei: "500000000000000000000",
        priceManipFactor: 2.5,
        flashLoanProvider: "0x1",
        victimProtocol: "0x2",
        generation: 1,
    },
    {
        id: "v2",
        loanAmountWei: "800000000000000000000",
        priceManipFactor: 3.0,
        flashLoanProvider: "0x1",
        victimProtocol: "0x2",
        generation: 1,
    },
    {
        id: "v3",
        loanAmountWei: "1200000000000000000000",
        priceManipFactor: 1.8,
        flashLoanProvider: "0x1",
        victimProtocol: "0x2",
        generation: 1,
    },
];

describe("BlueAgent", () => {
    it("returns null when no breaches occurred", () => {
        const agent = new BlueAgent({ policyPath: makeTempPolicy(BASE_POLICY) });
        const results: EvalResult[] = VARIANTS.map((v) => ({
            variantId: v.id,
            defended: true,
            detectionTimeMs: 100,
            defenseTimeMs: 200,
            deltaWei: "0",
        }));
        const proposal = agent.proposeUpdate(1, VARIANTS, results);
        expect(proposal).toBeNull();
    });

    it("proposes lowered loan threshold when breach detected", () => {
        const agent = new BlueAgent({ policyPath: makeTempPolicy(BASE_POLICY) });
        const results: EvalResult[] = [
            { variantId: "v1", defended: false, detectionTimeMs: 100, defenseTimeMs: 200, deltaWei: "1000" },
            { variantId: "v2", defended: true, detectionTimeMs: 100, defenseTimeMs: 200, deltaWei: "0" },
            { variantId: "v3", defended: true, detectionTimeMs: 100, defenseTimeMs: 200, deltaWei: "0" },
        ];
        const proposal = agent.proposeUpdate(1, VARIANTS, results);
        expect(proposal).not.toBeNull();
        // v1 breached with 500 ETH; threshold should be lowered to 80% of that = 400 ETH
        const loanChange = proposal!.changes.find((c) => c.path.includes("minLoanWei"));
        expect(loanChange).toBeDefined();
        expect(BigInt(loanChange!.newValue as string)).toBeLessThan(BigInt("500000000000000000000"));
    });

    it("proposes tightened price deviation when high-manip breach detected", () => {
        const agent = new BlueAgent({ policyPath: makeTempPolicy(BASE_POLICY) });
        const results: EvalResult[] = [
            { variantId: "v2", defended: false, detectionTimeMs: 100, defenseTimeMs: 200, deltaWei: "1000" },
            { variantId: "v1", defended: true, detectionTimeMs: 100, defenseTimeMs: 200, deltaWei: "0" },
            { variantId: "v3", defended: true, detectionTimeMs: 100, defenseTimeMs: 200, deltaWei: "0" },
        ];
        const proposal = agent.proposeUpdate(1, VARIANTS, results);
        expect(proposal).not.toBeNull();
        const priceChange = proposal!.changes.find((c) => c.path.includes("maxPriceDeviation"));
        expect(priceChange).toBeDefined();
        // v2 breached with 3.0x; threshold should be tightened to 90% of that = 2.7
        expect(priceChange!.newValue as number).toBeLessThan(3.0);
    });

    it("accepts proposal and updates internal policy", () => {
        const agent = new BlueAgent({ policyPath: makeTempPolicy(BASE_POLICY) });
        const results: EvalResult[] = [
            { variantId: "v1", defended: false, detectionTimeMs: 100, defenseTimeMs: 200, deltaWei: "1000" },
            { variantId: "v2", defended: true, detectionTimeMs: 100, defenseTimeMs: 200, deltaWei: "0" },
        ];
        const proposal = agent.proposeUpdate(1, VARIANTS.slice(0, 2), results);
        expect(proposal).not.toBeNull();
        agent.acceptProposal(proposal!);
        // Policy should be updated
        const rule = agent.policy.rules.find((r: any) => r.pattern === "FLASH_LOAN_ORACLE_MANIP");
        expect(BigInt(rule.params.minLoanWei)).toBeLessThan(BigInt(BASE_POLICY.rules[0].params.minLoanWei));
    });
});
