"""Federation aggregator — K-of-N verdict consensus.

Consumes `OperatorVerdict@1` envelopes from N independent detection
operators. Groups them by `(address, triggeringTxHash)` (the stable key
that identifies a single attack attempt) and emits a consolidated
`ThreatConfirmedEvent@2` once ≥K operators have reported `confirmed`
for the same attempt within the aggregation window.

The aggregator is deliberately simple and deterministic — no reputation
weighting yet, just a majority threshold. Reputation is an easy future
layer: scale each operator's contribution by its track record.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Iterable, Optional


@dataclass
class Attestation:
    """One operator's signed(-ish) statement about a given attack attempt."""
    operator_id: str
    model_hash: str
    confidence_bp: int
    anomaly_score: float
    sequence_score: float
    state: str
    level: str
    observations: int
    observed_at: str

    def to_dict(self) -> dict:
        return {
            "operatorId": self.operator_id,
            "modelHash": self.model_hash,
            "confidence": self.confidence_bp,
            "anomalyScore": round(self.anomaly_score, 4),
            "sequenceScore": round(self.sequence_score, 4),
            "state": self.state,
            "level": self.level,
            "observations": self.observations,
            "observedAt": self.observed_at,
        }


@dataclass
class _Bucket:
    """A growing set of attestations for one attack attempt."""
    address: str
    triggering_tx_hash: str
    victim_protocol: str
    pattern: str
    first_seen: float = field(default_factory=time.time)
    attestations: dict[str, Attestation] = field(default_factory=dict)  # operator_id → attestation
    published: bool = False


@dataclass
class ConsensusEvent:
    """What the aggregator publishes when a bucket clears threshold."""
    event_id: str
    address: str
    triggering_tx_hash: str
    pattern: str
    victim_protocol: str
    consensus_k: int
    consensus_n: int
    consensus_confidence_bp: int
    attestations: list[Attestation]
    observed_at: str

    def to_envelope(self) -> dict:
        return {
            "schema": "ThreatConfirmedEvent@2",
            "eventId": self.event_id,
            "confidence": self.consensus_confidence_bp,
            "pattern": self.pattern,
            "attackerAddresses": [self.address],
            "victimProtocol": self.victim_protocol,
            "triggeringTxHashes": [self.triggering_tx_hash],
            "observedAtBlock": 0,
            "timestamp": self.observed_at,
            "observations": sum(a.observations for a in self.attestations) // max(len(self.attestations), 1),
            "anomalyScore": round(
                sum(a.anomaly_score for a in self.attestations) / max(len(self.attestations), 1), 4
            ),
            "sequenceScore": round(
                sum(a.sequence_score for a in self.attestations) / max(len(self.attestations), 1), 4
            ),
            "federation": {
                "consensusK": self.consensus_k,
                "consensusN": self.consensus_n,
                "operatorAttestations": [a.to_dict() for a in self.attestations],
            },
        }


class FederationAggregator:
    """K-of-N verdict aggregator with a rolling bucket window.

    Usage:
        agg = FederationAggregator(operator_ids=["alpha","beta","gamma"], threshold_k=2)
        event = agg.ingest(envelope)  # returns ConsensusEvent when threshold crossed
        if event:
            publish(event.to_envelope())
    """

    def __init__(
        self,
        operator_ids: Iterable[str],
        *,
        threshold_k: int = 2,
        window_seconds: float = 60.0,
    ) -> None:
        self.operator_ids = set(operator_ids)
        if threshold_k < 1:
            raise ValueError("threshold_k must be ≥ 1")
        if threshold_k > len(self.operator_ids):
            raise ValueError("threshold_k cannot exceed number of operators")
        self.threshold_k = threshold_k
        self.window_seconds = window_seconds
        self._buckets: dict[tuple[str, str], _Bucket] = {}

    # ──────────────────────────────────────────────────────────────────
    # ingest / consensus
    # ──────────────────────────────────────────────────────────────────
    def ingest(self, envelope: dict) -> Optional[ConsensusEvent]:
        """Accept one `OperatorVerdict@1`. Returns a `ConsensusEvent`
        the first time the bucket crosses K-of-N, else None.

        Repeated verdicts from the same operator update that operator's
        attestation in the bucket — the most-recent attestation wins.
        Verdicts below `confirmed` level are tallied but don't themselves
        count toward consensus.
        """
        if envelope.get("schema") != "OperatorVerdict@1":
            return None

        operator_id = envelope.get("operatorId", "")
        if operator_id not in self.operator_ids:
            return None

        address = (envelope.get("address") or "").lower()
        tx_hash = envelope.get("triggeringTxHash", "")
        key = (address, tx_hash)
        if not address or not tx_hash:
            return None

        bucket = self._buckets.get(key)
        if bucket is None or self._expired(bucket):
            bucket = _Bucket(
                address=address,
                triggering_tx_hash=tx_hash,
                victim_protocol=envelope.get("victimProtocol", ""),
                pattern=envelope.get("pattern", "UNKNOWN"),
            )
            self._buckets[key] = bucket

        att = Attestation(
            operator_id=operator_id,
            model_hash=envelope.get("modelHash", ""),
            confidence_bp=int(envelope.get("confidence", 0)),
            anomaly_score=float(envelope.get("anomalyScore", 0.0)),
            sequence_score=float(envelope.get("sequenceScore", 0.0)),
            state=envelope.get("state", "IDLE"),
            level=envelope.get("level", "noise"),
            observations=int(envelope.get("observations", 0)),
            observed_at=envelope.get("observedAt", ""),
        )
        bucket.attestations[operator_id] = att

        # How many confirmed attestations do we have?
        confirmed = [a for a in bucket.attestations.values() if a.level == "confirmed"]
        if not bucket.published and len(confirmed) >= self.threshold_k:
            bucket.published = True
            return self._consensus_from(bucket, confirmed)

        # Periodic cleanup.
        self._prune()
        return None

    # ──────────────────────────────────────────────────────────────────
    def status(self) -> dict:
        """Snapshot for /health + /metrics."""
        active = [
            {
                "address": b.address[:10] + "…" + b.address[-4:] if len(b.address) > 10 else b.address,
                "triggeringTxHash": b.triggering_tx_hash[:10] + "…",
                "operators": [a.operator_id for a in b.attestations.values()],
                "confirmedCount": sum(1 for a in b.attestations.values() if a.level == "confirmed"),
                "published": b.published,
            }
            for b in self._buckets.values()
            if not self._expired(b)
        ]
        return {
            "operatorIds": sorted(self.operator_ids),
            "thresholdK": self.threshold_k,
            "thresholdN": len(self.operator_ids),
            "windowSeconds": self.window_seconds,
            "activeBuckets": active,
        }

    # ──────────────────────────────────────────────────────────────────
    # internals
    # ──────────────────────────────────────────────────────────────────
    def _consensus_from(self, bucket: _Bucket, confirmed: list[Attestation]) -> ConsensusEvent:
        # Aggregated confidence = mean of confirmed attestations' confidence.
        avg_bp = sum(a.confidence_bp for a in confirmed) // max(len(confirmed), 1)
        event_id = ("0x" + uuid.uuid4().hex + "0" * 32)[:66]
        # Sort attestations by operator_id for deterministic ordering.
        atts = sorted(bucket.attestations.values(), key=lambda a: a.operator_id)
        return ConsensusEvent(
            event_id=event_id,
            address=bucket.address,
            triggering_tx_hash=bucket.triggering_tx_hash,
            pattern=bucket.pattern,
            victim_protocol=bucket.victim_protocol,
            consensus_k=len(confirmed),
            consensus_n=len(self.operator_ids),
            consensus_confidence_bp=avg_bp,
            attestations=atts,
            observed_at=atts[-1].observed_at if atts else "",
        )

    def _expired(self, bucket: _Bucket) -> bool:
        return (time.time() - bucket.first_seen) > self.window_seconds

    def _prune(self) -> None:
        expired_keys = [k for k, b in self._buckets.items() if self._expired(b)]
        for k in expired_keys:
            del self._buckets[k]
