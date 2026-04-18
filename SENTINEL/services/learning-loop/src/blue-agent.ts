import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AttackVariant, EvalResult, PolicyChange, PolicyProposal } from "./types.js";

export interface BlueAgentConfig {
    policyPath: string;
}

export class BlueAgent {
    private currentPolicy: Record<string, any>;
    private policyPath: string;

    constructor(config: BlueAgentConfig) {
        this.policyPath = config.policyPath;
        this.currentPolicy = JSON.parse(readFileSync(config.policyPath, "utf-8"));
    }

    /**
     * Analyze breached variants and propose policy adjustments.
     *
     * Strategy:
     * 1. Look at the parameters of variants that breached the defense
     * 2. Tighten detection thresholds to catch them:
     *    - If breaches used high loan amounts → lower the loan size alert threshold
     *    - If breaches used high price manipulation → lower the price deviation threshold
     * 3. Reduce response time budget if attacks were fast
     */
    proposeUpdate(generation: number, variants: AttackVariant[], results: EvalResult[]): PolicyProposal | null {
        // Find breached variants (attacks that succeeded)
        const breaches = results.filter((r) => !r.defended);
        if (breaches.length === 0) {
            return null; // No breaches → no policy change needed
        }

        const breachedVariants = breaches
            .map((b) => variants.find((v) => v.id === b.variantId))
            .filter((v): v is AttackVariant => v !== undefined);

        const changes: PolicyChange[] = [];
        const updatedPolicy = JSON.parse(JSON.stringify(this.currentPolicy));

        // Analyze breach patterns and propose changes
        this.adjustLoanThreshold(breachedVariants, updatedPolicy, changes);
        this.adjustPriceThreshold(breachedVariants, updatedPolicy, changes);
        this.adjustResponseBudget(breaches, updatedPolicy, changes);

        if (changes.length === 0) {
            return null;
        }

        return {
            id: randomUUID(),
            policyJson: JSON.stringify(updatedPolicy, null, 2),
            changes,
            generation,
        };
    }

    /** Accept a proposal — update the in-memory policy */
    acceptProposal(proposal: PolicyProposal): void {
        this.currentPolicy = JSON.parse(proposal.policyJson);
    }

    get policy(): Record<string, any> {
        return this.currentPolicy;
    }

    private adjustLoanThreshold(breached: AttackVariant[], policy: Record<string, any>, changes: PolicyChange[]): void {
        if (breached.length === 0) return;

        // Find the minimum loan amount that breached
        const minBreachLoan = breached.reduce((min, v) => {
            const loan = BigInt(v.loanAmountWei);
            return loan < min ? loan : min;
        }, BigInt(breached[0].loanAmountWei));

        // Navigate to the flash loan rule in the policy
        const rules = policy.rules ?? [];
        const flashLoanRule = rules.find((r: any) => r.pattern === "FLASH_LOAN_ORACLE_MANIP");
        if (!flashLoanRule) return;

        const currentThreshold = BigInt(flashLoanRule.params?.minLoanWei ?? "0");
        // Set threshold to 80% of the minimum breach amount (to catch it next time)
        const newThreshold = (minBreachLoan * 80n) / 100n;

        if (newThreshold < currentThreshold || currentThreshold === 0n) {
            const oldVal = flashLoanRule.params?.minLoanWei ?? "0";
            if (!flashLoanRule.params) flashLoanRule.params = {};
            flashLoanRule.params.minLoanWei = newThreshold.toString();
            changes.push({
                path: "rules[FLASH_LOAN_ORACLE_MANIP].params.minLoanWei",
                oldValue: oldVal,
                newValue: newThreshold.toString(),
                reason: `Breach detected with loan ${minBreachLoan}; lowering threshold to catch it`,
            });
        }
    }

    private adjustPriceThreshold(
        breached: AttackVariant[],
        policy: Record<string, any>,
        changes: PolicyChange[],
    ): void {
        if (breached.length === 0) return;

        const maxPriceManip = Math.max(...breached.map((v) => v.priceManipFactor));
        const rules = policy.rules ?? [];
        const flashLoanRule = rules.find((r: any) => r.pattern === "FLASH_LOAN_ORACLE_MANIP");
        if (!flashLoanRule) return;

        const currentThreshold = flashLoanRule.params?.maxPriceDeviation ?? 999;
        // Tighten to 90% of the max breach manipulation (catch it next time)
        const newThreshold = Math.round(maxPriceManip * 0.9 * 100) / 100;

        if (newThreshold < currentThreshold) {
            const oldVal = flashLoanRule.params?.maxPriceDeviation ?? 999;
            if (!flashLoanRule.params) flashLoanRule.params = {};
            flashLoanRule.params.maxPriceDeviation = newThreshold;
            changes.push({
                path: "rules[FLASH_LOAN_ORACLE_MANIP].params.maxPriceDeviation",
                oldValue: oldVal,
                newValue: newThreshold,
                reason: `Breach with price manipulation ${maxPriceManip}x; tightening deviation threshold`,
            });
        }
    }

    private adjustResponseBudget(breaches: EvalResult[], policy: Record<string, any>, changes: PolicyChange[]): void {
        // If average detection time of breaches was under 1s, tighten response budget
        const avgDetection = breaches.reduce((sum, b) => sum + b.detectionTimeMs, 0) / breaches.length;
        if (avgDetection < 1000) {
            const currentBudget = policy.responseBudgetMs ?? 5000;
            const newBudget = Math.max(1000, currentBudget - 500);
            if (newBudget < currentBudget) {
                policy.responseBudgetMs = newBudget;
                changes.push({
                    path: "responseBudgetMs",
                    oldValue: currentBudget,
                    newValue: newBudget,
                    reason: `Fast breaches (avg ${Math.round(avgDetection)}ms detection); tightening response budget`,
                });
            }
        }
    }
}
