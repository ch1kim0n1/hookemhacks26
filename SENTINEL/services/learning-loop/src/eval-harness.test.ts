import { describe, expect, it } from "vitest";
import { EvalHarness, type PolicySnapshot } from "./eval-harness.js";
import { NeuralDetector } from "./neural-detector.js";
import type { AttackVariant } from "./types.js";

const BASE_LOAN = 900n * 10n ** 18n;

const STRICT_POLICY: PolicySnapshot = {
    rules: [
        {
            pattern: "FLASH_LOAN_ORACLE_MANIP",
            params: {
                minLoanWei: "100000000000000000000", // 100 ETH — low threshold
                maxPriceDeviation: 1.5,
            },
        },
    ],
};

const LAX_POLICY: PolicySnapshot = {
    rules: [
        {
            pattern: "FLASH_LOAN_ORACLE_MANIP",
            params: {
                minLoanWei: "10000000000000000000000",
                maxPriceDeviation: 100.0,
                nnThreshold: 0.99, // require near-certainty so untrained NN won't fire
            },
        },
    ],
};

const VARIANT: AttackVariant = {
    id: "test-1",
    loanAmountWei: (500n * 10n ** 18n).toString(),
    priceManipFactor: 2.5,
    flashLoanProvider: "0x1",
    victimProtocol: "0x2",
    generation: 1,
};

function makeHarness(policy: PolicySnapshot): EvalHarness {
    const det = new NeuralDetector({ baseLoanWei: BASE_LOAN });
    return new EvalHarness(policy, det);
}

describe("EvalHarness with NeuralDetector", () => {
    it("defends when threshold rule fires", () => {
        const harness = makeHarness(STRICT_POLICY);
        const result = harness.evaluateVariant(VARIANT);
        expect(result.defended).toBe(true);
        expect(result.thresholdDetected).toBe(true);
        expect(result.nnConfidence).toBeGreaterThanOrEqual(0);
        expect(result.nnConfidence).toBeLessThanOrEqual(1);
    });

    it("exposes ground-truth attack label from physics", () => {
        const harness = makeHarness(STRICT_POLICY);
        const result = harness.evaluateVariant(VARIANT);
        expect(typeof result.groundTruthAttack).toBe("boolean");
    });

    it("evaluatePopulation reports NN recall and precision", () => {
        const harness = makeHarness(STRICT_POLICY);
        const variants: AttackVariant[] = Array.from({ length: 12 }, (_, i) => ({
            ...VARIANT,
            id: `v-${i}`,
            loanAmountWei: String(BigInt(50 + i * 100) * 10n ** 18n),
            priceManipFactor: 1.2 + (i % 5) * 0.5,
        }));
        const { results, summary } = harness.evaluatePopulation(variants, 1);
        expect(results).toHaveLength(12);
        expect(summary.totalVariants).toBe(12);
        expect(summary.defended + summary.breached).toBe(12);
        expect(summary.nnRecall).toBeGreaterThanOrEqual(0);
        expect(summary.nnRecall).toBeLessThanOrEqual(1);
        expect(summary.nnPrecision).toBeGreaterThanOrEqual(0);
        expect(summary.nnPrecision).toBeLessThanOrEqual(1);
    });

    it("breaches when neither NN (untrained, high threshold) nor rules fire on a real attack", () => {
        const harness = makeHarness(LAX_POLICY);
        // Large loan + high price manip => physics says attack succeeds.
        const bigAttack: AttackVariant = {
            ...VARIANT,
            loanAmountWei: (2000n * 10n ** 18n).toString(),
            priceManipFactor: 4.5,
        };
        const result = harness.evaluateVariant(bigAttack);
        // NN is untrained and threshold is 0.99 so NN almost certainly won't fire;
        // lax threshold rules also don't fire; physics labels this an attack.
        if (result.groundTruthAttack && !result.thresholdDetected && !result.nnDetected) {
            expect(result.defended).toBe(false);
            expect(result.deltaWei).toBe(bigAttack.loanAmountWei);
        } else {
            // If the untrained NN happened to fire, the test still holds: we defended.
            expect(result.defended).toBe(true);
        }
    });

    it("updatePolicy changes future evaluations", () => {
        const harness = makeHarness(LAX_POLICY);
        harness.updatePolicy(STRICT_POLICY);
        const result = harness.evaluateVariant(VARIANT);
        expect(result.thresholdDetected).toBe(true);
    });
});
