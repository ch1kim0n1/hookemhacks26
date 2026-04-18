/** Rows from `services/detection-engine/bench/results/historical_attacks.md` — for `#/bench` UI. */
export interface BenchAttackRow {
    n: number;
    name: string;
    year: number;
    lossUsdM: number;
    caught: boolean;
    confidencePct: number;
    latencyMs: number;
}

export const BENCH_ATTACKS: BenchAttackRow[] = [
    { n: 1, name: "bZx #1 (ETH/sUSD)", year: 2020, lossUsdM: 0.35, caught: true, confidencePct: 100, latencyMs: 2.44 },
    { n: 2, name: "bZx #2 (sUSD/ETH)", year: 2020, lossUsdM: 0.65, caught: true, confidencePct: 100, latencyMs: 2.42 },
    { n: 3, name: "Harvest Finance", year: 2020, lossUsdM: 24.0, caught: true, confidencePct: 100, latencyMs: 2.28 },
    { n: 4, name: "Value DeFi", year: 2020, lossUsdM: 6.0, caught: true, confidencePct: 100, latencyMs: 2.38 },
    { n: 5, name: "Warp Finance", year: 2020, lossUsdM: 7.7, caught: true, confidencePct: 100, latencyMs: 2.62 },
    { n: 6, name: "Vee Finance", year: 2021, lossUsdM: 35.0, caught: true, confidencePct: 100, latencyMs: 2.38 },
    {
        n: 7,
        name: "Cream Finance (yUSD)",
        year: 2021,
        lossUsdM: 130.0,
        caught: true,
        confidencePct: 100,
        latencyMs: 2.44,
    },
    { n: 8, name: "Mango Markets", year: 2022, lossUsdM: 117.0, caught: true, confidencePct: 100, latencyMs: 2.31 },
];

export const BENCH_TOTAL_USD_M = BENCH_ATTACKS.reduce((s, r) => s + r.lossUsdM, 0);
