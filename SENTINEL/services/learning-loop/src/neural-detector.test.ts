import { describe, expect, it } from "vitest";
import { NeuralDetector, featurize, realOutcome } from "./neural-detector.js";
import type { AttackVariant } from "./types.js";

const BASE_LOAN = 900n * 10n ** 18n;
const POOL_DEPTH = 3_000n * 10n ** 18n;

function variant(loanFactor: number, priceFactor: number, gen = 1): AttackVariant {
    return {
        id: `v-${loanFactor}-${priceFactor}`,
        loanAmountWei: String(BigInt(Math.round(Number(BASE_LOAN) * loanFactor))),
        priceManipFactor: priceFactor,
        flashLoanProvider: "0x1",
        victimProtocol: "0x2",
        generation: gen,
    };
}

describe("featurize", () => {
    it("returns 5 normalized features", () => {
        const f = featurize(variant(1.0, 2.0), BASE_LOAN);
        expect(f).toHaveLength(5);
        expect(f[0]).toBeCloseTo(1.0, 3);
        expect(f[1]).toBeCloseTo(2.0, 3);
    });

    it("clamps large loans", () => {
        const f = featurize(variant(10, 10), BASE_LOAN);
        expect(f[0]).toBeLessThanOrEqual(4);
        expect(f[1]).toBeLessThanOrEqual(6);
    });
});

describe("realOutcome (physics)", () => {
    it("a tiny loan with tiny price move does not cause damage", () => {
        expect(realOutcome(variant(0.05, 1.01), BASE_LOAN, POOL_DEPTH)).toBe(false);
    });

    it("a large loan with big price move is a real attack", () => {
        expect(realOutcome(variant(2.0, 4.0), BASE_LOAN, POOL_DEPTH)).toBe(true);
    });

    it("priceFactor <= 1 is never an attack", () => {
        expect(realOutcome(variant(10, 1.0), BASE_LOAN, POOL_DEPTH)).toBe(false);
    });
});

describe("NeuralDetector", () => {
    it("learns from accumulated observations and improves accuracy", () => {
        const det = new NeuralDetector({ baseLoanWei: BASE_LOAN, learningRate: 0.1 });

        // Feed a broad distribution of variants — physics labels each.
        for (let i = 0; i < 200; i++) {
            const lf = 0.1 + Math.random() * 3.5;
            const pf = 1.0 + Math.random() * 4;
            det.observe(variant(lf, pf, (i % 5) + 1));
        }

        const before = det.model.evaluate(
            Array.from({ length: 50 }, () => {
                const lf = 0.1 + Math.random() * 3.5;
                const pf = 1.0 + Math.random() * 4;
                const v = variant(lf, pf, 1);
                const x = featurize(v, BASE_LOAN);
                const y = realOutcome(v, BASE_LOAN, BASE_LOAN * 3n) ? 1 : 0;
                return { x, y: y as 0 | 1 };
            }),
        );

        const metrics = det.train({ epochs: 40, batchSize: 16 });
        expect(metrics.length).toBe(40);

        const final = metrics[metrics.length - 1];
        expect(final.accuracy).toBeGreaterThan(before.accuracy - 0.05); // training shouldn't regress
        expect(final.accuracy).toBeGreaterThan(0.75); // should learn this physics reasonably
    });

    it("detect() returns both a boolean and confidence", () => {
        const det = new NeuralDetector({ baseLoanWei: BASE_LOAN });
        const r = det.detect(variant(1.0, 2.0));
        expect(typeof r.detected).toBe("boolean");
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
    });

    it("observe() records both classes given a balanced input distribution", () => {
        const det = new NeuralDetector({ baseLoanWei: BASE_LOAN });
        for (let i = 0; i < 100; i++) {
            const lf = 0.1 + Math.random() * 3.5;
            const pf = 1.0 + Math.random() * 4;
            det.observe(variant(lf, pf));
        }
        expect(det.bufferSize).toBe(100);
        expect(det.positiveRate).toBeGreaterThan(0);
        expect(det.positiveRate).toBeLessThan(1);
    });
});
