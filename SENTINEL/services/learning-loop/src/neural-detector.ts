import { MLP, type TrainMetrics } from "./nn.js";
import type { AttackVariant } from "./types.js";

/**
 * Feature extraction from an AttackVariant. The neural net sees a fixed-dim
 * real-valued vector, normalized so no single feature dominates gradient flow.
 *
 * Features (5-dim):
 *   0. loanFactor       loanAmount / baseLoan, clamped to [0, 4]
 *   1. priceFactor      priceManipFactor, clamped to [0, 6]
 *   2. log1pLoan        log(1 + loanFactor)  — compresses the tail
 *   3. interaction      loanFactor * (priceFactor - 1)
 *   4. generationSignal  tanh(generation / 10)  — lets the net learn temporal drift
 */
export function featurize(variant: AttackVariant, baseLoanWei: bigint): number[] {
    const loan = BigInt(variant.loanAmountWei);
    const loanFactor = baseLoanWei > 0n ? Number((loan * 10_000n) / baseLoanWei) / 10_000 : 1;
    const priceFactor = variant.priceManipFactor;
    const clampedLoan = Math.min(Math.max(loanFactor, 0), 4);
    const clampedPrice = Math.min(Math.max(priceFactor, 0), 6);
    return [
        clampedLoan,
        clampedPrice,
        Math.log1p(clampedLoan),
        clampedLoan * (clampedPrice - 1),
        Math.tanh(variant.generation / 10),
    ];
}

/**
 * Physics-backed "ground truth": given a variant, what actually happens on the
 * AMM when the attacker takes out `loanAmount` and pushes price by `priceFactor`?
 *
 * Simplified constant-product pool. The attacker's profit (and thus damage to
 * the victim) is non-linear in both variables and subject to pool-depth
 * damping. This gives the detector a genuine function to learn.
 *
 * Returns `true` if the attack would succeed (net exfiltration > threshold).
 */
export function realOutcome(variant: AttackVariant, baseLoanWei: bigint, poolDepthWei: bigint): boolean {
    const loan = Number(BigInt(variant.loanAmountWei));
    const pool = Number(poolDepthWei);
    const p = variant.priceManipFactor;

    if (loan <= 0 || pool <= 0 || p <= 1) return false;

    // Constant-product slippage approximation.
    const slippage = loan / (loan + pool);
    const effectiveManip = 1 + (p - 1) * (1 - slippage);

    // Exfiltration = loan * (effectiveManip - 1) * liquidation-efficiency (nonlinear).
    const liquidationEff = 0.85 - 0.2 * slippage;
    const exfiltrated = loan * (effectiveManip - 1) * liquidationEff;

    // Threshold: attack "succeeds" if net exfiltration > 3% of pool.
    const threshold = pool * 0.03;
    return exfiltrated > threshold;
}

export interface NeuralDetectorConfig {
    baseLoanWei: bigint;
    poolDepthWei?: bigint;
    learningRate?: number;
    confidenceThreshold?: number;
}

/**
 * Wraps an MLP as an online attack detector. The orchestrator calls:
 *   - `detect(variant)`   → predicts {detected, confidence}
 *   - `observe(variant, outcome)`  → appends to training buffer
 *   - `train(epochs)`     → runs backprop on the accumulated buffer
 */
export class NeuralDetector {
    readonly model: MLP;
    private buffer: Array<{ x: number[]; y: 0 | 1 }> = [];
    private readonly baseLoanWei: bigint;
    private readonly poolDepthWei: bigint;
    private readonly confidenceThreshold: number;
    private lastMetrics: TrainMetrics[] = [];

    constructor(cfg: NeuralDetectorConfig) {
        this.baseLoanWei = cfg.baseLoanWei;
        this.poolDepthWei = cfg.poolDepthWei ?? cfg.baseLoanWei * 3n;
        this.confidenceThreshold = cfg.confidenceThreshold ?? 0.5;
        this.model = new MLP({
            inputDim: 5,
            hidden1: 8,
            hidden2: 4,
            learningRate: cfg.learningRate ?? 0.05,
            momentum: 0.9,
            l2: 1e-4,
        });
    }

    detect(variant: AttackVariant): { detected: boolean; confidence: number } {
        const x = featurize(variant, this.baseLoanWei);
        const p = this.model.predict(x);
        return { detected: p >= this.confidenceThreshold, confidence: p };
    }

    /** Compute the true outcome via physics and record (variant, label). */
    observe(variant: AttackVariant): { groundTruthAttack: boolean } {
        const isAttack = realOutcome(variant, this.baseLoanWei, this.poolDepthWei);
        const x = featurize(variant, this.baseLoanWei);
        this.buffer.push({ x, y: isAttack ? 1 : 0 });
        // Keep the most recent 2000 samples to bound memory and favor recent generations.
        if (this.buffer.length > 2000) this.buffer.splice(0, this.buffer.length - 2000);
        return { groundTruthAttack: isAttack };
    }

    train(opts?: { epochs?: number; batchSize?: number }): TrainMetrics[] {
        if (this.buffer.length < 4) return [];
        this.lastMetrics = this.model.fit(this.buffer, opts);
        return this.lastMetrics;
    }

    get bufferSize(): number {
        return this.buffer.length;
    }

    get lastTrainingMetrics(): TrainMetrics[] {
        return this.lastMetrics;
    }

    /** Class balance of the training buffer (positive-class fraction). */
    get positiveRate(): number {
        if (this.buffer.length === 0) return 0;
        return this.buffer.filter((b) => b.y === 1).length / this.buffer.length;
    }
}
