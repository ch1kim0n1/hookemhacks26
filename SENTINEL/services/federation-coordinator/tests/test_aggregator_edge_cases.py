"""Additional edge-case tests for FederationAggregator.

The existing test_aggregator.py covers happy-path + basic validation. This
file adds coverage for: window expiry/pruning, address case-normalization,
deterministic attestation ordering, K==N majority, consensus averaging
rounding, and verdicts arriving after expiry.
"""
from __future__ import annotations

import time

from federation_coordinator.aggregator import FederationAggregator


ROSTER = ["alpha", "beta", "gamma"]
ATTACKER = "0x742d35Cc6634c0532925a3b844bc9e7595f0beb4"  # mixed case
ATTACKER_LOWER = ATTACKER.lower()
TX_HASH = "0x" + "de" * 32


def _verdict(
    operator_id: str,
    *,
    level: str = "confirmed",
    confidence: int = 9300,
    address: str = ATTACKER,
    tx_hash: str = TX_HASH,
) -> dict:
    return {
        "schema": "OperatorVerdict@1",
        "operatorId": operator_id,
        "modelHash": f"0x{operator_id[0] * 64}",
        "address": address,
        "state": "CONFIRMED",
        "level": level,
        "confidence": confidence,
        "anomalyScore": 0.85,
        "sequenceScore": 0.91,
        "observations": 3,
        "triggeringTxHash": tx_hash,
        "pattern": "FLASH_LOAN_ORACLE_MANIP",
        "victimProtocol": "0x9a676e781a523b5d0c0e43731313a708cb607508",
        "observedAt": "2026-04-17T00:00:00Z",
    }


# ──────────────────────────────────────────────────────────────────
# Address normalization
# ──────────────────────────────────────────────────────────────────
def test_address_is_case_insensitive_in_bucket_key():
    """Two operators reporting the same attacker with different casing
    must land in the same bucket."""
    agg = FederationAggregator(ROSTER, threshold_k=2)
    agg.ingest(_verdict("alpha", address=ATTACKER.upper()))
    event = agg.ingest(_verdict("beta", address=ATTACKER.lower()))
    assert event is not None, "differently-cased addresses must aggregate together"
    assert event.address == ATTACKER_LOWER


# ──────────────────────────────────────────────────────────────────
# K-of-N extremes
# ──────────────────────────────────────────────────────────────────
def test_k_equals_n_requires_unanimous_confirmation():
    agg = FederationAggregator(ROSTER, threshold_k=3)
    assert agg.ingest(_verdict("alpha")) is None
    assert agg.ingest(_verdict("beta")) is None
    event = agg.ingest(_verdict("gamma"))
    assert event is not None
    assert event.consensus_k == 3
    assert event.consensus_n == 3


def test_k_equals_one_fires_on_single_confirmation():
    agg = FederationAggregator(ROSTER, threshold_k=1)
    event = agg.ingest(_verdict("alpha"))
    assert event is not None
    assert event.consensus_k == 1


# ──────────────────────────────────────────────────────────────────
# Deterministic ordering
# ──────────────────────────────────────────────────────────────────
def test_attestations_sorted_by_operator_id():
    """Consensus event must order attestations deterministically so
    downstream hashes/proofs are stable regardless of arrival order."""
    agg_ab = FederationAggregator(ROSTER, threshold_k=2)
    agg_ab.ingest(_verdict("alpha"))
    ev1 = agg_ab.ingest(_verdict("beta"))

    agg_ba = FederationAggregator(ROSTER, threshold_k=2)
    agg_ba.ingest(_verdict("beta"))
    ev2 = agg_ba.ingest(_verdict("alpha"))

    order1 = [a.operator_id for a in ev1.attestations]
    order2 = [a.operator_id for a in ev2.attestations]
    assert order1 == order2 == ["alpha", "beta"]


# ──────────────────────────────────────────────────────────────────
# Confidence averaging
# ──────────────────────────────────────────────────────────────────
def test_consensus_confidence_is_integer_mean():
    agg = FederationAggregator(ROSTER, threshold_k=3)
    agg.ingest(_verdict("alpha", confidence=8000))
    agg.ingest(_verdict("beta", confidence=9000))
    event = agg.ingest(_verdict("gamma", confidence=9500))
    # (8000 + 9000 + 9500) // 3 = 8833
    assert event.consensus_confidence_bp == 8833


def test_consensus_only_averages_confirmed_attestations():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    # A high-confidence candidate arrives first but must not pollute the avg.
    agg.ingest(_verdict("alpha", level="candidate", confidence=9999))
    agg.ingest(_verdict("beta", confidence=8000))
    event = agg.ingest(_verdict("gamma", confidence=9000))
    # Mean of confirmed (beta + gamma) = 8500
    assert event.consensus_confidence_bp == 8500


# ──────────────────────────────────────────────────────────────────
# Window expiry / pruning
# ──────────────────────────────────────────────────────────────────
def test_expired_bucket_restarts_on_new_verdict():
    """If all prior attestations land outside the window, a new verdict
    should open a fresh bucket — not rejoin the stale one."""
    agg = FederationAggregator(ROSTER, threshold_k=2, window_seconds=10)
    agg.ingest(_verdict("alpha"))
    # Force alpha's bucket into the past by mutating its timestamp.
    for bucket in agg._buckets.values():
        bucket.first_seen = time.time() - 1000.0

    event = agg.ingest(_verdict("beta"))
    # alpha's original bucket is expired → a fresh one is created for beta
    # alone → below threshold.
    assert event is None
    event = agg.ingest(_verdict("gamma"))
    assert event is not None
    assert {a.operator_id for a in event.attestations} == {"beta", "gamma"}


def test_prune_drops_expired_buckets_from_status():
    agg = FederationAggregator(ROSTER, threshold_k=2, window_seconds=5)
    agg.ingest(_verdict("alpha", tx_hash="0x" + "a" * 64))
    # Force the existing bucket into the past.
    for bucket in agg._buckets.values():
        bucket.first_seen = time.time() - 1000.0

    # Ingest a fresh verdict on a different attack → triggers _prune().
    agg.ingest(_verdict("alpha", tx_hash="0x" + "b" * 64))
    buckets = agg.status()["activeBuckets"]
    # Only the fresh (non-expired) bucket shows in status.
    assert len(buckets) == 1
    # Status truncates the tx hash, so match the leading prefix.
    assert buckets[0]["triggeringTxHash"].startswith("0x" + "b" * 8)


# ──────────────────────────────────────────────────────────────────
# Idempotency
# ──────────────────────────────────────────────────────────────────
def test_consensus_is_published_exactly_once_per_bucket():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    first = agg.ingest(_verdict("alpha"))
    second = agg.ingest(_verdict("beta"))
    third = agg.ingest(_verdict("gamma"))
    fourth = agg.ingest(_verdict("alpha", confidence=10000))
    assert first is None
    assert second is not None
    assert third is None
    assert fourth is None


def test_event_ids_are_unique_across_attacks():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    agg.ingest(_verdict("alpha", tx_hash="0x" + "1" * 64))
    ev1 = agg.ingest(_verdict("beta", tx_hash="0x" + "1" * 64))

    agg.ingest(_verdict("alpha", tx_hash="0x" + "2" * 64))
    ev2 = agg.ingest(_verdict("beta", tx_hash="0x" + "2" * 64))
    assert ev1.event_id != ev2.event_id


# ──────────────────────────────────────────────────────────────────
# Envelope / audit integrity
# ──────────────────────────────────────────────────────────────────
def test_envelope_observations_is_integer_mean():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    v = _verdict("alpha")
    v["observations"] = 4
    agg.ingest(v)
    v = _verdict("beta")
    v["observations"] = 6
    event = agg.ingest(v)
    env = event.to_envelope()
    assert env["observations"] == 5  # (4 + 6) // 2


def test_envelope_scores_rounded_to_four_decimals():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    v1 = _verdict("alpha")
    v1["anomalyScore"] = 0.123456789
    v1["sequenceScore"] = 0.999999999
    agg.ingest(v1)
    v2 = _verdict("beta")
    v2["anomalyScore"] = 0.111111111
    v2["sequenceScore"] = 0.888888888
    event = agg.ingest(v2)
    env = event.to_envelope()
    # Both values are rounded when serialised.
    assert len(str(env["anomalyScore"]).split(".")[-1]) <= 4
    assert len(str(env["sequenceScore"]).split(".")[-1]) <= 4
