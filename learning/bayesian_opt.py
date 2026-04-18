"""Bayesian optimization over attack hyperparameters (lightweight stub)."""

from __future__ import annotations


def suggest_next(previous_scores: list[float]) -> float:
    """Return a scalar in [0,1] as next trial coordinate."""
    if not previous_scores:
        return 0.5
    return min(1.0, max(0.0, sum(previous_scores) / len(previous_scores)))
