"""Gaussian Process Bayesian optimizer — port of SENTINEL `bayesian-optimizer.ts`."""
from __future__ import annotations

import math
import random


class BayesianOptimizer:
    """2D GP with RBF kernel + UCB acquisition."""

    def __init__(self, kappa: float = 0.5, seed: int | None = None) -> None:
        self._obs: list[dict] = []
        self._bounds = ((0.3, 3.0), (1.0, 6.0))
        self._kappa = kappa
        self._rng = random.Random(seed)

    def observe(self, loan_factor: float, price_factor: float, breached: bool) -> None:
        self._obs.append({"x": [loan_factor, price_factor], "y": 1.0 if breached else 0.0})

    @property
    def observation_count(self) -> int:
        return len(self._obs)

    def suggest(self) -> tuple[float, float]:
        if len(self._obs) < 3:
            return self._random()
        best_acq = float("-inf")
        best = (1.0, 1.0)
        for c in self._grid(20):
            mean, std = self._gp_predict(c)
            acq = mean + self._kappa * std
            if acq > best_acq:
                best_acq = acq
                best = (c[0], c[1])
        return best

    def _random(self) -> tuple[float, float]:
        b0, b1 = self._bounds
        lf = b0[0] + self._rng.random() * (b0[1] - b0[0])
        pf = b1[0] + self._rng.random() * (b1[1] - b1[0])
        return lf, pf

    def _rbf(self, a: tuple[float, float], b: tuple[float, float], length: float = 1.0) -> float:
        b0, b1 = self._bounds
        d0 = (a[0] - b[0]) / (b0[1] - b0[0])
        d1 = (a[1] - b[1]) / (b1[1] - b1[0])
        return math.exp(-(d0 * d0 + d1 * d1) / (2 * length * length))

    def _gp_predict(self, x: tuple[float, float]) -> tuple[float, float]:
        n = len(self._obs)
        noise = 0.01
        k = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                xi = tuple(self._obs[i]["x"])  # type: ignore[arg-type]
                xj = tuple(self._obs[j]["x"])  # type: ignore[arg-type]
                k[i][j] = self._rbf(xi, xj) + (noise if i == j else 0.0)
        k_star = [self._rbf(x, tuple(o["x"])) for o in self._obs]  # type: ignore[arg-type]
        y = [o["y"] for o in self._obs]
        alpha = self._solve(k, y)
        mean = sum(k_star[i] * alpha[i] for i in range(n))
        k_inv_k_star = self._solve(k, k_star)
        v = sum(k_star[i] * k_inv_k_star[i] for i in range(n))
        variance = max(0.0, 1.0 - v)
        return max(0.0, min(1.0, mean)), math.sqrt(variance)

    def _solve(self, a: list[list[float]], b: list[float]) -> list[float]:
        n = len(b)
        m = [row + [b[i]] for i, row in enumerate(a)]
        for col in range(n):
            max_row = col
            for row in range(col + 1, n):
                if abs(m[row][col]) > abs(m[max_row][col]):
                    max_row = row
            m[col], m[max_row] = m[max_row], m[col]
            pivot = m[col][col]
            if abs(pivot) < 1e-12:
                continue
            for row in range(n):
                if row == col:
                    continue
                factor = m[row][col] / pivot
                for k in range(col, n + 1):
                    m[row][k] -= factor * m[col][k]
        return [0.0 if abs(m[i][i]) < 1e-12 else m[i][n] / m[i][i] for i in range(n)]

    def _grid(self, size: int) -> list[tuple[float, float]]:
        b0, b1 = self._bounds
        pts: list[tuple[float, float]] = []
        for i in range(size):
            for j in range(size):
                lf = b0[0] + (i / max(1, size - 1)) * (b0[1] - b0[0])
                pf = b1[0] + (j / max(1, size - 1)) * (b1[1] - b1[0])
                pts.append((lf, pf))
        return pts
