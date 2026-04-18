import { describe, expect, it } from "vitest";
import { RedAgent } from "./red-agent.js";

const CONFIG = {
    baseLoanWei: "900000000000000000000", // 900 ETH
    priceManipRange: [1.5, 3.0] as [number, number],
    flashLoanProvider: "0x1234567890abcdef1234567890abcdef12345678",
    victimProtocol: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
};

describe("RedAgent", () => {
    it("generates a population of the requested size", () => {
        const agent = new RedAgent(CONFIG);
        const population = agent.generatePopulation(10);
        expect(population).toHaveLength(10);
    });

    it("assigns unique IDs to each variant", () => {
        const agent = new RedAgent(CONFIG);
        const population = agent.generatePopulation(5);
        const ids = new Set(population.map((v) => v.id));
        expect(ids.size).toBe(5);
    });

    it("increments generation counter", () => {
        const agent = new RedAgent(CONFIG);
        agent.generatePopulation(3);
        expect(agent.currentGeneration).toBe(1);
        agent.generatePopulation(3);
        expect(agent.currentGeneration).toBe(2);
    });

    it("variants have loan amounts within expected range", () => {
        const agent = new RedAgent(CONFIG);
        const population = agent.generatePopulation(20);
        const baseLoan = 900000000000000000000n;
        for (const v of population) {
            const loan = BigInt(v.loanAmountWei);
            // Should be 50% to 200% of base
            expect(loan).toBeGreaterThan(baseLoan / 4n); // generous lower bound
            expect(loan).toBeLessThan(baseLoan * 3n); // generous upper bound
        }
    });

    it("variants have price manipulation within configured range", () => {
        const agent = new RedAgent(CONFIG);
        const population = agent.generatePopulation(20);
        for (const v of population) {
            expect(v.priceManipFactor).toBeGreaterThanOrEqual(1.0); // generous
            expect(v.priceManipFactor).toBeLessThanOrEqual(4.0); // generous
        }
    });

    it("mutates survivors from previous generation", () => {
        const agent = new RedAgent(CONFIG);
        const gen1 = agent.generatePopulation(5);
        // Pick 2 "survivors"
        const survivors = gen1.slice(0, 2);
        const gen2 = agent.generatePopulation(6, survivors);
        expect(gen2).toHaveLength(6);
        // At least some should have parentId set
        const mutants = gen2.filter((v) => v.parentId);
        expect(mutants.length).toBeGreaterThanOrEqual(1);
        // Mutants should reference parent IDs from survivors
        for (const m of mutants) {
            expect(survivors.some((s) => s.id === m.parentId)).toBe(true);
        }
    });

    it("all variants include correct addresses", () => {
        const agent = new RedAgent(CONFIG);
        const population = agent.generatePopulation(5);
        for (const v of population) {
            expect(v.flashLoanProvider).toBe(CONFIG.flashLoanProvider);
            expect(v.victimProtocol).toBe(CONFIG.victimProtocol);
        }
    });
});

import { BayesianOptimizer } from "./bayesian-optimizer.js";

describe("BayesianOptimizer", () => {
    it("suggests a point within parameter bounds before any observations", () => {
        const opt = new BayesianOptimizer();
        const { loanFactor, priceFactor } = opt.suggest();
        expect(loanFactor).toBeGreaterThanOrEqual(0.3);
        expect(loanFactor).toBeLessThanOrEqual(3.0);
        expect(priceFactor).toBeGreaterThanOrEqual(1.0);
        expect(priceFactor).toBeLessThanOrEqual(6.0);
    });

    it("records observations without throwing", () => {
        const opt = new BayesianOptimizer();
        expect(() => opt.observe(1.5, 3.0, true)).not.toThrow();
        expect(() => opt.observe(0.5, 1.5, false)).not.toThrow();
        expect(opt.observationCount).toBe(2);
    });

    it("suggests within bounds after several observations", () => {
        const opt = new BayesianOptimizer();
        opt.observe(1.0, 2.0, false);
        opt.observe(2.0, 4.0, true);
        opt.observe(2.5, 5.0, true);
        opt.observe(0.4, 1.2, false);
        const { loanFactor, priceFactor } = opt.suggest();
        expect(loanFactor).toBeGreaterThanOrEqual(0.3);
        expect(loanFactor).toBeLessThanOrEqual(3.0);
        expect(priceFactor).toBeGreaterThanOrEqual(1.0);
        expect(priceFactor).toBeLessThanOrEqual(6.0);
    });

    it("biases suggestions toward previously-breaching regions", () => {
        const opt = new BayesianOptimizer();
        // Seed: high loan + high price always breaches
        for (let i = 0; i < 6; i++) {
            opt.observe(2.8 + Math.random() * 0.2, 5.5 + Math.random() * 0.5, true);
            opt.observe(0.3 + Math.random() * 0.2, 1.0 + Math.random() * 0.2, false);
        }
        // Suggestion should lean toward the high-loan / high-price region
        const suggestions = Array.from({ length: 10 }, () => opt.suggest());
        const avgLoan = suggestions.reduce((s, p) => s + p.loanFactor, 0) / 10;
        const avgPrice = suggestions.reduce((s, p) => s + p.priceFactor, 0) / 10;
        expect(avgLoan).toBeGreaterThan(1.5);
        expect(avgPrice).toBeGreaterThan(3.0);
    });
});
