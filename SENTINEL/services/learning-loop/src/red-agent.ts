import { randomUUID } from "node:crypto";
import { BayesianOptimizer } from "./bayesian-optimizer.js";
import type { AttackVariant, EvalResult } from "./types.js";

export interface RedAgentConfig {
    baseLoanWei: string;
    priceManipRange: [number, number];
    flashLoanProvider: string;
    victimProtocol: string;
    /** When true, use Gaussian Process Bayesian optimization instead of pure
     *  random mutation after the first generation. Default: true. */
    useBayesian?: boolean;
}

export class RedAgent {
    private config: RedAgentConfig;
    private generation = 0;
    private optimizer: BayesianOptimizer;
    private readonly useBayesian: boolean;

    constructor(config: RedAgentConfig) {
        this.config = config;
        this.useBayesian = config.useBayesian ?? true;
        this.optimizer = new BayesianOptimizer();
    }

    /**
     * Generate a population of attack variants for the current generation.
     *
     * Generation 1: always random (no prior observations).
     * Generation 2+, Bayesian mode with ≥3 observations: 50% from GP optimizer,
     *   50% random (for exploration diversity).
     * Generation 2+, Bayesian mode with <3 observations OR non-Bayesian mode:
     *   50% mutated survivors + 50% random (genetic fallback).
     */
    generatePopulation(size: number, survivors?: AttackVariant[]): AttackVariant[] {
        this.generation++;
        const variants: AttackVariant[] = [];

        if (this.useBayesian && this.generation > 1 && this.optimizer.observationCount >= 3) {
            // Bayesian path: half from GP, half random.
            const bayesCount = Math.floor(size / 2);
            for (let i = 0; i < bayesCount; i++) {
                variants.push(this._fromOptimizer());
            }
        } else if (survivors && survivors.length > 0) {
            // Genetic fallback: mutate survivors (pre-warmup Bayesian OR non-Bayesian).
            const mutationCount = Math.min(Math.floor(size / 2), survivors.length);
            for (let i = 0; i < mutationCount; i++) {
                variants.push(this._mutate(survivors[i]));
            }
        }

        while (variants.length < size) {
            variants.push(this._random());
        }
        return variants;
    }

    /**
     * Feed evaluation results back to the Bayesian optimizer.
     * Call after each generation's eval completes.
     */
    observeResults(variants: AttackVariant[], results: EvalResult[]): void {
        if (!this.useBayesian) return;
        const base = BigInt(this.config.baseLoanWei);
        for (const result of results) {
            const variant = variants.find((v) => v.id === result.variantId);
            if (!variant) continue;
            const loanFactor = base > 0n ? Number(BigInt(variant.loanAmountWei) * 100n) / Number(base) / 100 : 1.0;
            this.optimizer.observe(loanFactor, variant.priceManipFactor, !result.defended);
        }
    }

    get currentGeneration(): number {
        return this.generation;
    }

    // ── private ────────────────────────────────────────────────────────────

    private _fromOptimizer(): AttackVariant {
        const { loanFactor, priceFactor } = this.optimizer.suggest();
        const base = BigInt(this.config.baseLoanWei);
        const loanAmount = BigInt(Math.floor(Number(base) * loanFactor));
        return {
            id: randomUUID(),
            loanAmountWei: loanAmount.toString(),
            priceManipFactor: Math.round(priceFactor * 100) / 100,
            flashLoanProvider: this.config.flashLoanProvider,
            victimProtocol: this.config.victimProtocol,
            generation: this.generation,
        };
    }

    private _random(): AttackVariant {
        const base = BigInt(this.config.baseLoanWei);
        const factor = 0.5 + Math.random() * 1.5;
        const loanAmount = BigInt(Math.floor(Number(base) * factor));
        const [minManip, maxManip] = this.config.priceManipRange;
        const priceManipFactor = minManip + Math.random() * (maxManip - minManip);
        return {
            id: randomUUID(),
            loanAmountWei: loanAmount.toString(),
            priceManipFactor: Math.round(priceManipFactor * 100) / 100,
            flashLoanProvider: this.config.flashLoanProvider,
            victimProtocol: this.config.victimProtocol,
            generation: this.generation,
        };
    }

    private _mutate(parent: AttackVariant): AttackVariant {
        const base = BigInt(parent.loanAmountWei);
        const perturbation = 0.8 + Math.random() * 0.4;
        const newLoan = BigInt(Math.floor(Number(base) * perturbation));
        const pricePerturbation = 0.9 + Math.random() * 0.2;
        const newPriceFactor = Math.round(parent.priceManipFactor * pricePerturbation * 100) / 100;
        return {
            id: randomUUID(),
            loanAmountWei: newLoan.toString(),
            priceManipFactor: newPriceFactor,
            flashLoanProvider: parent.flashLoanProvider,
            victimProtocol: parent.victimProtocol,
            generation: this.generation,
            parentId: parent.id,
        };
    }
}
