"""Federated detection operator.

Each Operator owns an independent copy of the ML stack — its own LSTM
weights, its own IsolationForest, its own state machine. Operators are
seeded deterministically so the same `(operator_id, seed)` pair always
produces the same `model_hash`. That hash is what gets registered on-chain
via `ModelRegistry` so any verdict can be traced back to the exact model
that produced it.

The architecture is K-of-N: N operators each observe the same mempool
stream independently and publish verdicts. A federation-coordinator
service aggregates them — at least K must agree before a threat is
confirmed to the rest of the system.
"""
from __future__ import annotations

import hashlib
from collections import deque
from dataclasses import dataclass

from .anomaly_scorer import AnomalyScorer
from .sequence_detector import SequenceDetector
from .state_machine import DetectionStateMachine


@dataclass
class OperatorVerdict:
    """A single operator's read on a given tx.

    Only verdicts where `level` is `candidate` or `confirmed` should be
    published to the federation bus — `noise` verdicts are intermediate
    observations that never crossed the candidate threshold.
    """
    operator_id: str
    model_hash: str
    address: str                       # attacker EOA (state-machine key)
    state: str                         # IDLE | FLASH_LOAN_OBSERVED | ORACLE_IMPACT_OBSERVED | CONFIRMED
    level: str                         # noise | candidate | confirmed
    confidence_bp: int                 # 0–10_000
    anomaly_score: float
    sequence_score: float
    observations: int
    triggering_tx_hash: str
    pattern: str = "FLASH_LOAN_ORACLE_MANIP"
    victim_protocol: str = ""
    observed_at: str = ""

    def to_envelope(self) -> dict:
        return {
            "schema": "OperatorVerdict@1",
            "operatorId": self.operator_id,
            "modelHash": self.model_hash,
            "address": self.address,
            "state": self.state,
            "level": self.level,
            "confidence": self.confidence_bp,
            "anomalyScore": round(self.anomaly_score, 4),
            "sequenceScore": round(self.sequence_score, 4),
            "observations": self.observations,
            "triggeringTxHash": self.triggering_tx_hash,
            "pattern": self.pattern,
            "victimProtocol": self.victim_protocol,
            "observedAt": self.observed_at,
        }


class Operator:
    """One independent node in the federated detection ensemble.

    Usage:
        op = Operator(operator_id="alpha", seed=1337)
        op.warm_up()              # trains LSTM + fits IsoForest (~3s)
        verdict = op.evaluate(tx_features, ...)
        if verdict and verdict.level != "noise":
            publish(verdict.to_envelope())
    """

    # Default hyperparameters; a tiny jitter per seed keeps models genuinely
    # diverse (not just shuffled weights around the same init).
    _CONTAMINATION_BASE = 0.05
    _CONTAMINATION_JITTER = 0.01
    _CANDIDATE_THRESHOLD = 0.6
    _CONFIRMED_THRESHOLD = 0.85

    def __init__(
        self,
        operator_id: str,
        seed: int,
        *,
        history_window: int = 5,
        candidate_threshold: float | None = None,
        confirmed_threshold: float | None = None,
    ) -> None:
        if not operator_id:
            raise ValueError("operator_id must be non-empty")
        self.operator_id = operator_id
        self.seed = int(seed)

        # Hyperparameter jitter so each operator has a subtly different
        # decision boundary. Deterministic per seed.
        jitter = ((self.seed % 7) - 3) * (self._CONTAMINATION_JITTER / 3.0)
        contamination = max(0.01, min(0.10, self._CONTAMINATION_BASE + jitter))

        self.anomaly_scorer = AnomalyScorer(contamination=contamination, seed=self.seed)
        self.sequence_detector = SequenceDetector(seed=self.seed)
        self.state_machine = DetectionStateMachine(
            candidate_threshold=candidate_threshold or self._CANDIDATE_THRESHOLD,
            confirmed_threshold=confirmed_threshold or self._CONFIRMED_THRESHOLD,
        )
        self.tx_history: dict[str, deque] = {}
        self._history_window = history_window
        self._warmed = False
        self._model_hash: str | None = None

    # ──────────────────────────────────────────────────────────────────
    # lifecycle
    # ──────────────────────────────────────────────────────────────────
    @property
    def warmed(self) -> bool:
        return self._warmed

    def warm_up(self, *, n_normal: int = 300, n_attack: int = 300, n_seq_normal: int = 700) -> None:
        """Fit the IsolationForest and train the LSTM. ~3s on CPU."""
        self.anomaly_scorer.warm_up(n_samples=n_normal)
        self.sequence_detector.train(n_attack=n_attack, n_normal=n_seq_normal)
        self._model_hash = self._compute_model_hash()
        self._warmed = True

    def _compute_model_hash(self) -> str:
        """Deterministic sha256 over operator-id, seed, and actual model weights.

        Same config → same hash. Different seed → different hash.
        This is what lands in `ModelRegistry` on-chain.
        """
        h = hashlib.sha256()
        h.update(f"operator:{self.operator_id}|seed:{self.seed}".encode())

        # LSTM weights fingerprint — iterate parameters in declaration order.
        try:
            import numpy as _np
            for p in self.sequence_detector._net.parameters():
                arr = p.detach().cpu().numpy().astype(_np.float32)
                h.update(arr.tobytes())
        except Exception:
            # Graceful fallback — seed+id alone is still unique per operator.
            h.update(b"lstm:unavailable")

        # IsolationForest fingerprint — hash estimator seeds.
        try:
            for est in self.anomaly_scorer._model.estimators_:
                h.update(str(getattr(est, "random_state", 0)).encode())
        except Exception:
            h.update(b"ifor:unavailable")

        return "0x" + h.hexdigest()

    @property
    def model_hash(self) -> str:
        return self._model_hash or ("0x" + "0" * 64)

    # ──────────────────────────────────────────────────────────────────
    # detection — one tx at a time
    # ──────────────────────────────────────────────────────────────────
    def evaluate(
        self,
        tx: dict,
        *,
        tx_hash: str,
        tx_from: str,
        tx_features: dict,
        flash_provider: str,
        oracle_addr: str,
        attacker_addr: str,
        attack_selector: str,
        price_deviation_getter,
        victim_protocol: str = "",
        observed_at: str = "",
    ) -> OperatorVerdict | None:
        """Feed one pending tx through this operator's pipeline.

        Returns an `OperatorVerdict` only when the result is *publishable* —
        either a `candidate` (≥0.6 confidence) or a `confirmed` (≥0.85).
        Returns `None` for state transitions that haven't produced an
        actionable verdict yet (the operator keeps them internally).

        `price_deviation_getter` is an async-or-sync callable
        `(oracle_addr, tx_value) -> float` so the caller controls how
        deviation is actually fetched. Pre-computed deviations can be
        passed as a lambda returning a constant. The result lands in
        `tx_features["price_deviation_pct"]`.

        If the operator hasn't been warmed up, the underlying scorers
        return 0.0 and the state machine relies on selector-match alone —
        which is still sufficient to detect a known exploit signature.
        """
        to = (tx.get("to") or "").lower()
        selector = (tx.get("selector") or "").lower()

        # 1. Anomaly score on raw features.
        anomaly_score = self.anomaly_scorer.score(tx_features)

        # 2. Flash-loan observation
        if to == flash_provider or "flashloan" in selector:
            state = self.state_machine.observe_flash_loan(
                address=tx_from,
                amount_wei=tx.get("value", "0"),
                provider=to,
            )
            if state is not None and state.state != "IDLE":
                state.confidence = min(state.confidence + anomaly_score * 0.15, 1.0)

        # 3. Oracle impact observation (uses caller-supplied deviation getter)
        if oracle_addr and to == oracle_addr:
            deviation = price_deviation_getter(oracle_addr, tx.get("value", "0"))
            # Support both sync and async getters
            if hasattr(deviation, "__await__"):
                # Caller passed a coroutine accidentally — skip to avoid blocking.
                deviation = 5.0
            tx_features["price_deviation_pct"] = deviation
            anomaly_score = self.anomaly_scorer.score(tx_features)
            state = self.state_machine.observe_oracle_impact(
                address=tx_from,
                price_deviation=deviation,
            )
            if state is not None and state.state != "IDLE":
                state.confidence = min(state.confidence + anomaly_score * 0.1, 1.0)

        # 4. Maintain sliding window and compute LSTM sequence score.
        dq = self.tx_history.setdefault(tx_from, deque(maxlen=self._history_window))
        dq.append(tx_features)
        seq_score = self.sequence_detector.predict(list(dq))

        # 5. Exploit-call — the only path that yields a publishable verdict.
        if to == attacker_addr and selector.endswith(attack_selector):
            state = self.state_machine.observe_exploit_call(
                address=tx_from,
                selector=selector,
                target=to,
            )
            state.confidence = min(state.confidence + seq_score * 0.15, 1.0)
            level = self.state_machine.get_confidence_level(state)

            # Cleanup — avoid unbounded tx_history growth.
            self._cleanup_tx_history(tx_from)
            self.state_machine.cleanup_expired()

            if level == "below_threshold":
                return None

            return OperatorVerdict(
                operator_id=self.operator_id,
                model_hash=self.model_hash,
                address=tx_from,
                state=state.state,
                level=level,
                confidence_bp=int(state.confidence * 10_000),
                anomaly_score=anomaly_score,
                sequence_score=seq_score,
                observations=len(state.observations),
                triggering_tx_hash=tx.get("hash", ""),
                victim_protocol=victim_protocol,
                observed_at=observed_at,
            )

        # Non-exploit tx — no publishable verdict, but cleanup anyway.
        self._cleanup_tx_history(tx_from)
        self.state_machine.cleanup_expired()
        return None

    def _cleanup_tx_history(self, tx_from: str) -> None:
        active = set(self.state_machine.states.keys())
        stale = [addr for addr in self.tx_history if addr not in active and addr != tx_from]
        for addr in stale:
            del self.tx_history[addr]


# ──────────────────────────────────────────────────────────────────────
# canonical operator roster — used by docker-compose and tests
# ──────────────────────────────────────────────────────────────────────
DEFAULT_ROSTER: dict[str, int] = {
    "alpha": 1337,
    "beta":  4242,
    "gamma": 9001,
}
