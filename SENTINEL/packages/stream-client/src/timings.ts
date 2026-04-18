import { readFileSync } from "node:fs";

export interface Timings {
    detection: {
        candidateConfidenceFloor: number;
        confirmedConfidenceFloor: number;
        windowSeconds: number;
    };
    proof: {
        timeoutMs: number;
        cacheEnabled: boolean;
    };
    defense: {
        responseBudgetMs: number;
        cooldownMs: number;
    };
    demo: {
        scenarioADelayMs: number;
        scenarioBDelayMs: number;
    };
}

const DEFAULT_TIMINGS: Timings = {
    detection: { candidateConfidenceFloor: 0.6, confirmedConfidenceFloor: 0.85, windowSeconds: 30 },
    proof: { timeoutMs: 10000, cacheEnabled: true },
    defense: { responseBudgetMs: 5000, cooldownMs: 1000 },
    demo: { scenarioADelayMs: 5000, scenarioBDelayMs: 3000 },
};

export function loadTimings(path?: string): Timings {
    const filePath = path ?? process.env.TIMINGS_PATH ?? "../../config/timings.json";
    try {
        const raw = JSON.parse(readFileSync(filePath, "utf-8"));
        return {
            ...DEFAULT_TIMINGS,
            ...raw,
            detection: { ...DEFAULT_TIMINGS.detection, ...raw.detection },
            proof: { ...DEFAULT_TIMINGS.proof, ...raw.proof },
            defense: { ...DEFAULT_TIMINGS.defense, ...raw.defense },
            demo: { ...DEFAULT_TIMINGS.demo, ...raw.demo },
        };
    } catch {
        return DEFAULT_TIMINGS;
    }
}
