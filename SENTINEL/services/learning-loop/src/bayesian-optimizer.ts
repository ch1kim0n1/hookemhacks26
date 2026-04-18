/**
 * Gaussian Process Bayesian Optimizer for 2D attack parameter space.
 *
 * Uses an RBF (squared-exponential) kernel and Upper Confidence Bound
 * (UCB) acquisition to suggest the next parameter point to evaluate.
 *
 * Parameter space:
 *   loanFactor  ∈ [0.3, 3.0]  — multiplier on baseLoanWei
 *   priceFactor ∈ [1.0, 6.0]  — price manipulation multiplier
 *
 * Reward: 1.0 if the variant breached the defense, 0.0 if defended.
 *
 * Falls back to uniform random sampling when fewer than 3 observations
 * have been recorded (not enough data for a meaningful GP posterior).
 */
export class BayesianOptimizer {
    private obs: Array<{ x: [number, number]; y: number }> = [];
    private readonly bounds: [[number, number], [number, number]] = [
        [0.3, 3.0],
        [1.0, 6.0],
    ];
    private readonly kappa = 0.5; // UCB exploration-exploitation trade-off

    /** Record the outcome of one evaluated parameter point. */
    observe(loanFactor: number, priceFactor: number, breached: boolean): void {
        this.obs.push({ x: [loanFactor, priceFactor], y: breached ? 1.0 : 0.0 });
    }

    /** Return the next parameter point to evaluate (UCB acquisition). */
    suggest(): { loanFactor: number; priceFactor: number } {
        if (this.obs.length < 3) {
            return this._random();
        }
        const candidates = this._grid(20);
        let bestAcq = -Infinity;
        let best = candidates[0];
        for (const c of candidates) {
            const { mean, std } = this._gpPredict(c);
            const acq = mean + this.kappa * std;
            if (acq > bestAcq) {
                bestAcq = acq;
                best = c;
            }
        }
        return { loanFactor: best[0], priceFactor: best[1] };
    }

    get observationCount(): number {
        return this.obs.length;
    }

    // ── internals ─────────────────────────────────────────────────────────

    private _random(): { loanFactor: number; priceFactor: number } {
        const loanFactor = this.bounds[0][0] + Math.random() * (this.bounds[0][1] - this.bounds[0][0]);
        const priceFactor = this.bounds[1][0] + Math.random() * (this.bounds[1][1] - this.bounds[1][0]);
        return { loanFactor, priceFactor };
    }

    /** RBF kernel — inputs are normalised to [0,1] before distance calc. */
    private _rbf(a: [number, number], b: [number, number], l = 1.0): number {
        const d0 = (a[0] - b[0]) / (this.bounds[0][1] - this.bounds[0][0]);
        const d1 = (a[1] - b[1]) / (this.bounds[1][1] - this.bounds[1][0]);
        return Math.exp(-(d0 * d0 + d1 * d1) / (2 * l * l));
    }

    /** GP posterior mean and standard deviation at candidate point x. */
    private _gpPredict(x: [number, number]): { mean: number; std: number } {
        const n = this.obs.length;
        const noise = 0.01;

        // Kernel matrix K (n×n) with noise on diagonal.
        const K: number[][] = Array.from({ length: n }, (_, i) =>
            Array.from({ length: n }, (_, j) => this._rbf(this.obs[i].x, this.obs[j].x) + (i === j ? noise : 0)),
        );

        const kStar = this.obs.map((o) => this._rbf(x, o.x));
        const y = this.obs.map((o) => o.y);

        const alpha = this._solve(K, y);
        const mean = kStar.reduce((s, k, i) => s + k * alpha[i], 0);

        const KinvKStar = this._solve(K, kStar);
        const v = kStar.reduce((s, k, i) => s + k * KinvKStar[i], 0);
        const variance = Math.max(0, 1.0 - v);

        return {
            mean: Math.max(0, Math.min(1, mean)),
            std: Math.sqrt(variance),
        };
    }

    /** Gaussian elimination solver for Ax = b (n ≤ ~50). */
    private _solve(A: number[][], b: number[]): number[] {
        const n = b.length;
        const M = A.map((row, i) => [...row, b[i]]);
        for (let col = 0; col < n; col++) {
            let maxRow = col;
            for (let row = col + 1; row < n; row++) {
                if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
            }
            [M[col], M[maxRow]] = [M[maxRow], M[col]];
            const pivot = M[col][col];
            if (Math.abs(pivot) < 1e-12) continue;
            for (let row = 0; row < n; row++) {
                if (row === col) continue;
                const factor = M[row][col] / pivot;
                for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
            }
        }
        return M.map((row, i) => (Math.abs(M[i][i]) < 1e-12 ? 0 : row[n] / row[i]));
    }

    /** 20×20 grid of candidate points covering the full parameter space. */
    private _grid(size: number): Array<[number, number]> {
        const pts: Array<[number, number]> = [];
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                pts.push([
                    this.bounds[0][0] + (i / (size - 1)) * (this.bounds[0][1] - this.bounds[0][0]),
                    this.bounds[1][0] + (j / (size - 1)) * (this.bounds[1][1] - this.bounds[1][0]),
                ]);
            }
        }
        return pts;
    }
}
