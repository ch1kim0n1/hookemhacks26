import { log } from "./logger.js";
import type { NeuralDetector } from "./neural-detector.js";
import type { AttackVariant, EvalResult, EvalSummary } from "./types.js";

export interface PolicySnapshot {
    rules: Array<{
        pattern: string;
        params?: {
            minLoanWei?: string;
            maxPriceDeviation?: number;
            /** Confidence threshold the neural detector must clear to flag (0-1). */
            nnThreshold?: number;
        };
    }>;
    responseBudgetMs?: number;
}

/**
 * Defense evaluation: runs each variant through both
 *  - a neural-network detector (the Blue agent's learned model), and
 *  - the declarative policy thresholds (safety floor).
 *
 * Either signal firing triggers defense. Ground-truth labels come from the
 * detector's physics model (see NeuralDetector.observe), so the "breach" vs
 * "defended" outcome reflects whether the NN (or thresholds) actually caught
 * an attack that would have succeeded in the simulated pool.
 */
export class EvalHarness {
    private policy: PolicySnapshot;
    private detector: NeuralDetector;

    constructor(policy: PolicySnapshot, detector: NeuralDetector) {
        this.policy = policy;
        this.detector = detector;
    }

    updatePolicy(policy: PolicySnapshot): void {
        this.policy = policy;
    }

    evaluateVariant(variant: AttackVariant): EvalResult {
        const flashLoanRule = this.policy.rules?.find((r) => r.pattern === "FLASH_LOAN_ORACLE_MANIP");

        // 1. Ground truth via physics (records sample to NN training buffer).
        const { groundTruthAttack } = this.detector.observe(variant);

        // 2. Neural network prediction.
        const { detected: nnDetected, confidence } = this.detector.detect(variant);
        const nnThreshold = flashLoanRule?.params?.nnThreshold ?? 0.5;
        const nnFires = confidence >= nnThreshold;

        // 3. Threshold fallback (keeps us defended while the NN is still learning).
        let thresholdFires = false;
        if (flashLoanRule?.params) {
            const { minLoanWei, maxPriceDeviation } = flashLoanRule.params;
            if (minLoanWei) {
                const loanAmount = BigInt(variant.loanAmountWei);
                if (loanAmount >= BigInt(minLoanWei)) thresholdFires = true;
            }
            if (maxPriceDeviation !== undefined && variant.priceManipFactor >= maxPriceDeviation) {
                thresholdFires = true;
            }
        }

        const detected = nnFires || thresholdFires;

        // Outcome: only an attack that is both REAL and UNDETECTED causes damage.
        const defended = groundTruthAttack ? detected : true;

        // Timing: NN inference is fast (~1-5ms sim); thresholds near-instant;
        // defense submission adds a bounded amount.
        const detectionTimeMs = 5 + Math.random() * 25;
        const defenseTimeMs = defended && detected ? 80 + Math.random() * 120 : 0;

        return {
            variantId: variant.id,
            defended,
            detectionTimeMs: Math.round(detectionTimeMs),
            defenseTimeMs: Math.round(defenseTimeMs),
            deltaWei: defended ? "0" : variant.loanAmountWei,
            nnConfidence: Math.round(confidence * 10000) / 10000,
            groundTruthAttack,
            nnDetected: nnFires,
            thresholdDetected: thresholdFires,
        };
    }

    evaluatePopulation(
        variants: AttackVariant[],
        generation: number,
    ): {
        results: EvalResult[];
        summary: EvalSummary;
    } {
        const results = variants.map((v) => this.evaluateVariant(v));

        const defended = results.filter((r) => r.defended).length;
        const breached = results.filter((r) => !r.defended).length;
        const winRate = variants.length > 0 ? defended / variants.length : 0;

        const truePositives = results.filter((r) => r.groundTruthAttack && r.nnDetected).length;
        const falseNegatives = results.filter((r) => r.groundTruthAttack && !r.nnDetected).length;
        const falsePositives = results.filter((r) => !r.groundTruthAttack && r.nnDetected).length;
        const trueNegatives = results.filter((r) => !r.groundTruthAttack && !r.nnDetected).length;

        const attacks = truePositives + falseNegatives;
        const benign = trueNegatives + falsePositives;
        const nnRecall = attacks > 0 ? truePositives / attacks : 0;
        const nnPrecision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
        const nnFalsePositiveRate = benign > 0 ? falsePositives / benign : 0;

        const avgDetectionMs =
            results.length > 0 ? results.reduce((sum, r) => sum + r.detectionTimeMs, 0) / results.length : 0;
        const defendedResults = results.filter((r) => r.defended && r.defenseTimeMs > 0);
        const avgDefenseMs =
            defendedResults.length > 0
                ? defendedResults.reduce((sum, r) => sum + r.defenseTimeMs, 0) / defendedResults.length
                : 0;

        const summary: EvalSummary = {
            generation,
            totalVariants: variants.length,
            defended,
            breached,
            winRate: Math.round(winRate * 10000) / 10000,
            avgDetectionMs: Math.round(avgDetectionMs),
            avgDefenseMs: Math.round(avgDefenseMs),
            meetsThreshold: false,
            nnRecall: Math.round(nnRecall * 10000) / 10000,
            nnPrecision: Math.round(nnPrecision * 10000) / 10000,
            nnFalsePositiveRate: Math.round(nnFalsePositiveRate * 10000) / 10000,
            trueAttackRate: Math.round((attacks / Math.max(1, results.length)) * 10000) / 10000,
        };

        log.info(
            {
                generation,
                total: variants.length,
                defended,
                breached,
                winRate: summary.winRate,
                nnRecall: summary.nnRecall,
                nnPrecision: summary.nnPrecision,
            },
            "eval complete",
        );

        return { results, summary };
    }
}
