"""IsolationForest anomaly scorer for individual transaction features.

Fitted on synthetic normal-traffic baseline at startup. Returns an
anomaly probability in [0, 1]; values > 0.5 indicate unusual activity.
"""
from __future__ import annotations

import numpy as np
from sklearn.ensemble import IsolationForest

from .tx_features import extract


class AnomalyScorer:
    """Unsupervised anomaly detector using Isolation Forest.

    Usage:
        scorer = AnomalyScorer()
        scorer.warm_up()          # call once at service startup
        score = scorer.score(tx)  # call per tx, returns float in [0, 1]
    """

    def __init__(self, contamination: float = 0.05, *, seed: int = 42) -> None:
        self._seed = seed
        self._model = IsolationForest(
            contamination=contamination,
            n_estimators=100,
            random_state=seed,
        )
        self._fitted = False

    @property
    def fitted(self) -> bool:
        return self._fitted

    @property
    def seed(self) -> int:
        return self._seed

    def warm_up(self, n_samples: int = 300) -> None:
        """Fit on synthetic normal traffic to establish a baseline.

        Normal traffic: small loans, low price deviation, typical gas.
        Called once during service startup — takes ~50ms.
        """
        rng = np.random.default_rng(self._seed)
        normal = np.column_stack([
            rng.uniform(0.0, 0.05, n_samples),    # loan_norm: tiny loans
            rng.uniform(0.0, 1.0, n_samples),      # price_deviation_pct: <1%
            rng.uniform(0.1, 0.3, n_samples),      # gas_price_norm: 10–30 gwei
            np.zeros(n_samples),                    # is_known_selector: no
            np.zeros(n_samples),                    # to_is_oracle: no
        ])
        self._model.fit(normal)
        self._fitted = True

    def score(self, tx: dict) -> float:
        """Return anomaly score in [0, 1]. Higher means more anomalous.

        Returns 0.0 if warm_up() has not been called yet.
        """
        if not self._fitted:
            return 0.0
        features = np.array([extract(tx)], dtype=np.float64)
        # decision_function: positive = inlier, negative = outlier
        raw = float(self._model.decision_function(features)[0])
        # Map to [0, 1]: inliers (~0.1) → ~0.0; outliers (~-0.2) → ~0.9
        return float(max(0.0, min(1.0, (-raw + 0.05) * 4.0)))
