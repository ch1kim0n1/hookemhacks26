/**
 * Small multilayer perceptron for binary classification (attack vs benign).
 *
 * Implements forward + backward pass by hand (no tfjs/torch) so the learning
 * loop stays lightweight — the neural net trains in-process alongside the
 * orchestrator without external runtime dependencies.
 *
 * Architecture:
 *   input (N_features)
 *       → Linear(N_features, 8)  + ReLU
 *       → Linear(8, 4)            + ReLU
 *       → Linear(4, 1)            + Sigmoid
 *   loss: binary cross-entropy
 *   optimizer: SGD with momentum
 *
 * Weights initialized with He init (fan_in-scaled gaussian).
 */

type Matrix = number[][];
type Vec = number[];

function gaussian(): number {
    // Box-Muller
    const u1 = Math.max(Math.random(), 1e-9);
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function heInit(rows: number, cols: number): Matrix {
    const stddev = Math.sqrt(2 / cols);
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => gaussian() * stddev));
}

function zerosMat(rows: number, cols: number): Matrix {
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
}

function zerosVec(n: number): Vec {
    return Array.from({ length: n }, () => 0);
}

function matmulVec(W: Matrix, x: Vec): Vec {
    const out = new Array(W.length).fill(0);
    for (let i = 0; i < W.length; i++) {
        let s = 0;
        const row = W[i];
        for (let j = 0; j < x.length; j++) s += row[j] * x[j];
        out[i] = s;
    }
    return out;
}

function sigmoid(z: number): number {
    if (z >= 0) {
        const e = Math.exp(-z);
        return 1 / (1 + e);
    }
    const e = Math.exp(z);
    return e / (1 + e);
}

export interface MLPConfig {
    inputDim: number;
    hidden1?: number;
    hidden2?: number;
    learningRate?: number;
    momentum?: number;
    l2?: number;
}

export interface TrainMetrics {
    epoch: number;
    loss: number;
    accuracy: number;
    examples: number;
}

export class MLP {
    readonly inputDim: number;
    private readonly h1: number;
    private readonly h2: number;
    private lr: number;
    private readonly mom: number;
    private readonly l2: number;

    // Weights
    private W1: Matrix;
    private b1: Vec;
    private W2: Matrix;
    private b2: Vec;
    private W3: Matrix;
    private b3: Vec;

    // Velocities for momentum
    private vW1: Matrix;
    private vb1: Vec;
    private vW2: Matrix;
    private vb2: Vec;
    private vW3: Matrix;
    private vb3: Vec;

    constructor(cfg: MLPConfig) {
        this.inputDim = cfg.inputDim;
        this.h1 = cfg.hidden1 ?? 8;
        this.h2 = cfg.hidden2 ?? 4;
        this.lr = cfg.learningRate ?? 0.05;
        this.mom = cfg.momentum ?? 0.9;
        this.l2 = cfg.l2 ?? 1e-4;

        this.W1 = heInit(this.h1, this.inputDim);
        this.b1 = zerosVec(this.h1);
        this.W2 = heInit(this.h2, this.h1);
        this.b2 = zerosVec(this.h2);
        this.W3 = heInit(1, this.h2);
        this.b3 = zerosVec(1);

        this.vW1 = zerosMat(this.h1, this.inputDim);
        this.vb1 = zerosVec(this.h1);
        this.vW2 = zerosMat(this.h2, this.h1);
        this.vb2 = zerosVec(this.h2);
        this.vW3 = zerosMat(1, this.h2);
        this.vb3 = zerosVec(1);
    }

    /** Forward pass returning prediction in [0,1]. */
    predict(x: Vec): number {
        if (x.length !== this.inputDim) {
            throw new Error(`expected input of dim ${this.inputDim}, got ${x.length}`);
        }
        const z1 = matmulVec(this.W1, x).map((v, i) => v + this.b1[i]);
        const a1 = z1.map((v) => Math.max(0, v));
        const z2 = matmulVec(this.W2, a1).map((v, i) => v + this.b2[i]);
        const a2 = z2.map((v) => Math.max(0, v));
        const z3 = matmulVec(this.W3, a2).map((v, i) => v + this.b3[i]);
        return sigmoid(z3[0]);
    }

    /** Run one mini-batch gradient-descent step. Returns the mean loss on the batch. */
    trainStep(batch: Array<{ x: Vec; y: 0 | 1 }>): number {
        if (batch.length === 0) return 0;

        const gW1 = zerosMat(this.h1, this.inputDim);
        const gb1 = zerosVec(this.h1);
        const gW2 = zerosMat(this.h2, this.h1);
        const gb2 = zerosVec(this.h2);
        const gW3 = zerosMat(1, this.h2);
        const gb3 = zerosVec(1);

        let lossSum = 0;

        for (const { x, y } of batch) {
            // Forward, caching activations.
            const z1 = matmulVec(this.W1, x).map((v, i) => v + this.b1[i]);
            const a1 = z1.map((v) => Math.max(0, v));
            const z2 = matmulVec(this.W2, a1).map((v, i) => v + this.b2[i]);
            const a2 = z2.map((v) => Math.max(0, v));
            const z3 = matmulVec(this.W3, a2)[0] + this.b3[0];
            const p = sigmoid(z3);

            // BCE loss (clamped to avoid log(0)).
            const eps = 1e-7;
            const pc = Math.min(Math.max(p, eps), 1 - eps);
            lossSum += -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc));

            // Backward.
            const dz3 = p - y; // dL/dz3 for sigmoid+BCE
            // W3 (1 x h2), b3 (1)
            for (let j = 0; j < this.h2; j++) gW3[0][j] += dz3 * a2[j];
            gb3[0] += dz3;

            // da2 = W3^T · dz3 (shape h2)
            const da2 = new Array(this.h2).fill(0);
            for (let j = 0; j < this.h2; j++) da2[j] = this.W3[0][j] * dz3;

            // dz2 = da2 * relu'(z2)
            const dz2 = da2.map((v, i) => (z2[i] > 0 ? v : 0));

            for (let i = 0; i < this.h2; i++) {
                for (let j = 0; j < this.h1; j++) gW2[i][j] += dz2[i] * a1[j];
                gb2[i] += dz2[i];
            }

            const da1 = new Array(this.h1).fill(0);
            for (let j = 0; j < this.h1; j++) {
                let s = 0;
                for (let i = 0; i < this.h2; i++) s += this.W2[i][j] * dz2[i];
                da1[j] = s;
            }
            const dz1 = da1.map((v, i) => (z1[i] > 0 ? v : 0));

            for (let i = 0; i < this.h1; i++) {
                for (let j = 0; j < this.inputDim; j++) gW1[i][j] += dz1[i] * x[j];
                gb1[i] += dz1[i];
            }
        }

        const n = batch.length;
        // Apply averaged grads + L2 regularization + momentum step.
        this.applyGrad(this.W1, gW1, this.vW1, this.b1, gb1, this.vb1, n);
        this.applyGrad(this.W2, gW2, this.vW2, this.b2, gb2, this.vb2, n);
        this.applyGrad(this.W3, gW3, this.vW3, this.b3, gb3, this.vb3, n);

        return lossSum / n;
    }

    private applyGrad(W: Matrix, gW: Matrix, vW: Matrix, b: Vec, gb: Vec, vb: Vec, n: number): void {
        for (let i = 0; i < W.length; i++) {
            for (let j = 0; j < W[i].length; j++) {
                const grad = gW[i][j] / n + this.l2 * W[i][j];
                vW[i][j] = this.mom * vW[i][j] - this.lr * grad;
                W[i][j] += vW[i][j];
            }
            const gradB = gb[i] / n;
            vb[i] = this.mom * vb[i] - this.lr * gradB;
            b[i] += vb[i];
        }
    }

    /** Train on all examples for `epochs` with given batch size; returns per-epoch metrics. */
    fit(data: Array<{ x: Vec; y: 0 | 1 }>, opts?: { epochs?: number; batchSize?: number }): TrainMetrics[] {
        const epochs = opts?.epochs ?? 5;
        const batchSize = Math.max(1, opts?.batchSize ?? 8);
        const metrics: TrainMetrics[] = [];

        for (let e = 1; e <= epochs; e++) {
            // Shuffle
            const shuffled = [...data];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            let epochLoss = 0;
            let batches = 0;
            for (let i = 0; i < shuffled.length; i += batchSize) {
                const batch = shuffled.slice(i, i + batchSize);
                epochLoss += this.trainStep(batch);
                batches++;
            }

            const { accuracy } = this.evaluate(data);
            metrics.push({
                epoch: e,
                loss: Math.round((epochLoss / Math.max(1, batches)) * 1e6) / 1e6,
                accuracy: Math.round(accuracy * 10000) / 10000,
                examples: data.length,
            });
        }
        return metrics;
    }

    /** Returns accuracy and counts on the provided dataset. */
    evaluate(data: Array<{ x: Vec; y: 0 | 1 }>): { accuracy: number; truePositive: number; trueNegative: number } {
        if (data.length === 0) return { accuracy: 0, truePositive: 0, trueNegative: 0 };
        let correct = 0;
        let tp = 0;
        let tn = 0;
        for (const { x, y } of data) {
            const p = this.predict(x);
            const pred = p >= 0.5 ? 1 : 0;
            if (pred === y) {
                correct++;
                if (y === 1) tp++;
                else tn++;
            }
        }
        return { accuracy: correct / data.length, truePositive: tp, trueNegative: tn };
    }

    /** Serialize weights to JSON for persistence / debugging. */
    toJSON(): Record<string, unknown> {
        return {
            inputDim: this.inputDim,
            hidden1: this.h1,
            hidden2: this.h2,
            W1: this.W1,
            b1: this.b1,
            W2: this.W2,
            b2: this.b2,
            W3: this.W3,
            b3: this.b3,
        };
    }

    setLearningRate(lr: number): void {
        this.lr = lr;
    }
}
