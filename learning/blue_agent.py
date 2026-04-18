"""Multilayer perceptron — Python port of SENTINEL `nn.ts` (manual backprop, SGD+momentum, He init)."""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Any, Literal

Matrix = list[list[float]]
Vec = list[float]


def _gaussian(rng: random.Random) -> float:
    u1 = max(rng.random(), 1e-9)
    u2 = rng.random()
    return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


def _he_init(rows: int, cols: int, rng: random.Random) -> Matrix:
    stddev = math.sqrt(2 / cols)
    return [[_gaussian(rng) * stddev for _ in range(cols)] for _ in range(rows)]


def _zeros_mat(rows: int, cols: int) -> Matrix:
    return [[0.0 for _ in range(cols)] for _ in range(rows)]


def _zeros_vec(n: int) -> Vec:
    return [0.0 for _ in range(n)]


def _matmul_vec(w: Matrix, x: Vec) -> Vec:
    return [sum(w[i][j] * x[j] for j in range(len(x))) for i in range(len(w))]


def _sigmoid(z: float) -> float:
    if z >= 0:
        e = math.exp(-z)
        return 1 / (1 + e)
    e = math.exp(z)
    return e / (1 + e)


@dataclass
class TrainMetrics:
    epoch: int
    loss: float
    accuracy: float
    examples: int


class MLP:
    """5→8→4→1 MLP when input_dim=5 (default attack feature vector)."""

    def __init__(
        self,
        input_dim: int,
        *,
        hidden1: int = 8,
        hidden2: int = 4,
        learning_rate: float = 0.05,
        momentum: float = 0.9,
        l2: float = 1e-4,
        seed: int | None = 1337,
    ) -> None:
        self.input_dim = input_dim
        self._h1 = hidden1
        self._h2 = hidden2
        self.lr = learning_rate
        self.mom = momentum
        self.l2 = l2
        self._rng = random.Random(seed)

        self.W1 = _he_init(self._h1, self.input_dim, self._rng)
        self.b1 = _zeros_vec(self._h1)
        self.W2 = _he_init(self._h2, self._h1, self._rng)
        self.b2 = _zeros_vec(self._h2)
        self.W3 = _he_init(1, self._h2, self._rng)
        self.b3 = _zeros_vec(1)

        self.vW1 = _zeros_mat(self._h1, self.input_dim)
        self.vb1 = _zeros_vec(self._h1)
        self.vW2 = _zeros_mat(self._h2, self._h1)
        self.vb2 = _zeros_vec(self._h2)
        self.vW3 = _zeros_mat(1, self._h2)
        self.vb3 = _zeros_vec(1)

    def predict(self, x: Vec) -> float:
        if len(x) != self.input_dim:
            raise ValueError(f"expected input dim {self.input_dim}, got {len(x)}")
        z1 = [sum(self.W1[i][j] * x[j] for j in range(self.input_dim)) + self.b1[i] for i in range(self._h1)]
        a1 = [max(0.0, v) for v in z1]
        z2 = [sum(self.W2[i][j] * a1[j] for j in range(self._h1)) + self.b2[i] for i in range(self._h2)]
        a2 = [max(0.0, v) for v in z2]
        z3 = sum(self.W3[0][j] * a2[j] for j in range(self._h2)) + self.b3[0]
        return _sigmoid(z3)

    def train_step(self, batch: list[tuple[Vec, Literal[0, 1]]]) -> float:
        if not batch:
            return 0.0
        gW1 = _zeros_mat(self._h1, self.input_dim)
        gb1 = _zeros_vec(self._h1)
        gW2 = _zeros_mat(self._h2, self._h1)
        gb2 = _zeros_vec(self._h2)
        gW3 = _zeros_mat(1, self._h2)
        gb3 = _zeros_vec(1)
        loss_sum = 0.0
        eps = 1e-7

        for x, y in batch:
            z1 = [sum(self.W1[i][j] * x[j] for j in range(self.input_dim)) + self.b1[i] for i in range(self._h1)]
            a1 = [max(0.0, v) for v in z1]
            z2 = [sum(self.W2[i][j] * a1[j] for j in range(self._h1)) + self.b2[i] for i in range(self._h2)]
            a2 = [max(0.0, v) for v in z2]
            z3 = sum(self.W3[0][j] * a2[j] for j in range(self._h2)) + self.b3[0]
            p = _sigmoid(z3)
            pc = min(max(p, eps), 1 - eps)
            loss_sum += -(y * math.log(pc) + (1 - y) * math.log(1 - pc))
            dz3 = p - y
            for j in range(self._h2):
                gW3[0][j] += dz3 * a2[j]
            gb3[0] += dz3
            da2 = [self.W3[0][j] * dz3 for j in range(self._h2)]
            dz2 = [da2[i] if z2[i] > 0 else 0.0 for i in range(self._h2)]
            for i in range(self._h2):
                for j in range(self._h1):
                    gW2[i][j] += dz2[i] * a1[j]
                gb2[i] += dz2[i]
            da1 = [0.0] * self._h1
            for j in range(self._h1):
                da1[j] = sum(self.W2[i][j] * dz2[i] for i in range(self._h2))
            dz1 = [da1[i] if z1[i] > 0 else 0.0 for i in range(self._h1)]
            for i in range(self._h1):
                for j in range(self.input_dim):
                    gW1[i][j] += dz1[i] * x[j]
                gb1[i] += dz1[i]

        n = len(batch)
        self._apply_grad(self.W1, gW1, self.vW1, self.b1, gb1, self.vb1, n)
        self._apply_grad(self.W2, gW2, self.vW2, self.b2, gb2, self.vb2, n)
        self._apply_grad(self.W3, gW3, self.vW3, self.b3, gb3, self.vb3, n)
        return loss_sum / n

    def _apply_grad(
        self,
        w: Matrix,
        gw: Matrix,
        vw: Matrix,
        b: Vec,
        gb: Vec,
        vb: Vec,
        n: int,
    ) -> None:
        for i in range(len(w)):
            for j in range(len(w[i])):
                grad = gw[i][j] / n + self.l2 * w[i][j]
                vw[i][j] = self.mom * vw[i][j] - self.lr * grad
                w[i][j] += vw[i][j]
            grad_b = gb[i] / n
            vb[i] = self.mom * vb[i] - self.lr * grad_b
            b[i] += vb[i]

    def fit(
        self,
        data: list[tuple[Vec, Literal[0, 1]]],
        *,
        epochs: int = 5,
        batch_size: int = 8,
    ) -> list[TrainMetrics]:
        metrics: list[TrainMetrics] = []
        for e in range(1, epochs + 1):
            shuffled = list(data)
            self._rng.shuffle(shuffled)
            epoch_loss = 0.0
            batches = 0
            for i in range(0, len(shuffled), batch_size):
                batch = shuffled[i : i + batch_size]
                epoch_loss += self.train_step(batch)
                batches += 1
            acc = self.evaluate(data)["accuracy"]
            metrics.append(
                TrainMetrics(
                    epoch=e,
                    loss=round(epoch_loss / max(1, batches) * 1e6) / 1e6,
                    accuracy=round(acc * 10000) / 10000,
                    examples=len(data),
                )
            )
        return metrics

    def evaluate(self, data: list[tuple[Vec, Literal[0, 1]]]) -> dict[str, float | int]:
        if not data:
            return {"accuracy": 0.0, "truePositive": 0, "trueNegative": 0}
        correct = 0
        tp = tn = 0
        for x, y in data:
            p = self.predict(x)
            pred = 1 if p >= 0.5 else 0
            if pred == y:
                correct += 1
                if y == 1:
                    tp += 1
                else:
                    tn += 1
        return {"accuracy": correct / len(data), "truePositive": tp, "trueNegative": tn}

    def set_learning_rate(self, lr: float) -> None:
        self.lr = lr


class BlueAgent(MLP):
    """Thin `MLP` wrapper for the learning orchestrator (`forward` entrypoint)."""

    def __init__(self, input_dim: int = 5, **kwargs: Any) -> None:
        super().__init__(input_dim, **kwargs)

    def forward(self, features: Vec) -> float:
        return self.predict(features)
