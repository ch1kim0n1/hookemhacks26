"""Bridge off-chain detector features to on-chain anomaly scores (IsolationForest-style stub)."""

from __future__ import annotations


def score_transaction_features(features: list[float]) -> float:
    """Return anomaly score in [0,1]; higher = more suspicious."""
    if not features:
        return 0.0
    return min(1.0, max(features) - min(features))
