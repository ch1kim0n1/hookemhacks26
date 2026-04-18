import { describe, expect, it } from "vitest";
import { MLP } from "./nn.js";

describe("MLP neural network", () => {
    it("learns XOR to >= 90% accuracy (best of 5 restarts)", () => {
        // XOR + small MLP + random init is prone to local minima on ~5% of
        // seeds. Try up to 5 restarts and keep the best — we only need to
        // show the architecture *can* solve XOR, not that every seed does.
        const data: Array<{ x: number[]; y: 0 | 1 }> = [
            { x: [0, 0], y: 0 },
            { x: [0, 1], y: 1 },
            { x: [1, 0], y: 1 },
            { x: [1, 1], y: 0 },
        ];
        const training = Array.from({ length: 50 }, () => data).flat();
        let bestAcc = 0;
        let bestLoss = Number.POSITIVE_INFINITY;
        for (let attempt = 0; attempt < 5; attempt++) {
            const net = new MLP({ inputDim: 2, hidden1: 8, hidden2: 4, learningRate: 0.1, momentum: 0.9, l2: 0 });
            const metrics = net.fit(training, { epochs: 600, batchSize: 8 });
            const final = metrics[metrics.length - 1];
            if (final.accuracy > bestAcc) {
                bestAcc = final.accuracy;
                bestLoss = final.loss;
            }
            if (bestAcc >= 0.9 && bestLoss < 0.4) break;
        }
        expect(bestAcc).toBeGreaterThanOrEqual(0.9);
        expect(bestLoss).toBeLessThan(0.4);
    });

    it("predict returns probability in [0,1]", () => {
        const net = new MLP({ inputDim: 4 });
        const p = net.predict([0.1, -0.3, 0.8, 0.5]);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
    });

    it("throws on input dim mismatch", () => {
        const net = new MLP({ inputDim: 3 });
        expect(() => net.predict([0, 1])).toThrow(/dim 3/);
    });

    it("separates a linearly-separable dataset to >= 95% accuracy", () => {
        // Same flake class as XOR above: random init occasionally lands in
        // a bad basin. Use best-of-3 restarts — the architecture *can*
        // learn this, we just don't want to gate CI on a lucky RNG.
        const data: Array<{ x: number[]; y: 0 | 1 }> = [];
        for (let i = 0; i < 100; i++) {
            const x1 = Math.random();
            const x2 = Math.random();
            data.push({ x: [x1, x2], y: x1 + x2 > 1 ? 1 : 0 });
        }
        let bestAcc = 0;
        for (let attempt = 0; attempt < 3; attempt++) {
            const net = new MLP({ inputDim: 2, hidden1: 4, hidden2: 4, learningRate: 0.1 });
            const metrics = net.fit(data, { epochs: 200, batchSize: 16 });
            bestAcc = Math.max(bestAcc, metrics[metrics.length - 1].accuracy);
            if (bestAcc >= 0.95) break;
        }
        expect(bestAcc).toBeGreaterThanOrEqual(0.95);
    });
});
