"""Unit tests for the federation aggregator — K-of-N verdict consensus."""
from __future__ import annotations

import pytest

from federation_coordinator.aggregator import FederationAggregator


ROSTER = ["alpha", "beta", "gamma"]
ATTACKER = "0x742d35cc6634c0532925a3b844bc9e7595f0beb4"
TX_HASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"


def _verdict(operator_id: str, level: str = "confirmed", *,
             model_hash: str | None = None, confidence: int = 9300,
             address: str = ATTACKER, tx_hash: str = TX_HASH,
             anomaly: float = 0.85, seq: float = 0.91) -> dict:
    return {
        "schema": "OperatorVerdict@1",
        "operatorId": operator_id,
        "modelHash": model_hash or f"0x{operator_id[0] * 64}",
        "address": address,
        "state": "CONFIRMED" if level == "confirmed" else "ORACLE_IMPACT_OBSERVED",
        "level": level,
        "confidence": confidence,
        "anomalyScore": anomaly,
        "sequenceScore": seq,
        "observations": 3,
        "triggeringTxHash": tx_hash,
        "pattern": "FLASH_LOAN_ORACLE_MANIP",
        "victimProtocol": "0x9a676e781a523b5d0c0e43731313a708cb607508",
        "observedAt": "2026-04-17T00:00:00Z",
    }


# ──────────────────────────────────────────────────────────────────────
# construction
# ──────────────────────────────────────────────────────────────────────
def test_rejects_bad_threshold():
    with pytest.raises(ValueError):
        FederationAggregator(ROSTER, threshold_k=0)
    with pytest.raises(ValueError):
        FederationAggregator(ROSTER, threshold_k=4)  # > N


# ──────────────────────────────────────────────────────────────────────
# happy-path consensus
# ──────────────────────────────────────────────────────────────────────
def test_three_of_three_emits_consensus():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    assert agg.ingest(_verdict("alpha")) is None
    event = agg.ingest(_verdict("beta"))
    assert event is not None
    assert event.consensus_k == 2
    assert event.consensus_n == 3
    # Third attestation arriving after consensus doesn't re-emit.
    later = agg.ingest(_verdict("gamma"))
    assert later is None


def test_two_of_three_is_sufficient():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    agg.ingest(_verdict("alpha"))
    event = agg.ingest(_verdict("beta"))
    assert event is not None


def test_one_of_three_does_not_emit():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    event = agg.ingest(_verdict("alpha"))
    assert event is None


def test_mixed_levels_only_confirmed_counts():
    # Two candidates + one confirmed shouldn't clear K=2 (need 2 confirmed).
    agg = FederationAggregator(ROSTER, threshold_k=2)
    agg.ingest(_verdict("alpha", level="candidate", confidence=7000))
    agg.ingest(_verdict("beta", level="candidate", confidence=7100))
    event = agg.ingest(_verdict("gamma", level="confirmed"))
    assert event is None


# ──────────────────────────────────────────────────────────────────────
# envelope / consensus event shape
# ──────────────────────────────────────────────────────────────────────
def test_consensus_envelope_has_schema_v2():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    agg.ingest(_verdict("alpha", confidence=9200))
    event = agg.ingest(_verdict("beta", confidence=9400))
    env = event.to_envelope()
    assert env["schema"] == "ThreatConfirmedEvent@2"
    assert env["pattern"] == "FLASH_LOAN_ORACLE_MANIP"
    assert env["attackerAddresses"] == [ATTACKER]
    assert env["triggeringTxHashes"] == [TX_HASH]
    # Mean of confirming operators.
    assert env["confidence"] == 9300
    fed = env["federation"]
    assert fed["consensusK"] == 2
    assert fed["consensusN"] == 3
    assert len(fed["operatorAttestations"]) == 2
    assert {a["operatorId"] for a in fed["operatorAttestations"]} == {"alpha", "beta"}


def test_attestations_carry_model_hashes_for_audit():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    agg.ingest(_verdict("alpha", model_hash="0x" + "a" * 64))
    event = agg.ingest(_verdict("beta", model_hash="0x" + "b" * 64))
    hashes = [a.model_hash for a in event.attestations]
    assert "0x" + "a" * 64 in hashes
    assert "0x" + "b" * 64 in hashes


# ──────────────────────────────────────────────────────────────────────
# validation / resilience
# ──────────────────────────────────────────────────────────────────────
def test_ignores_non_operator_verdict():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    # "delta" is not in the roster.
    assert agg.ingest(_verdict("delta")) is None
    agg.ingest(_verdict("alpha"))
    event = agg.ingest(_verdict("delta"))
    # delta is still ignored; only alpha has attested → below threshold.
    assert event is None


def test_ignores_wrong_schema():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    bad = _verdict("alpha")
    bad["schema"] = "SomethingElse@1"
    assert agg.ingest(bad) is None


def test_ignores_verdict_without_address_or_tx_hash():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    v = _verdict("alpha")
    v["address"] = ""
    assert agg.ingest(v) is None
    v = _verdict("alpha")
    v["triggeringTxHash"] = ""
    assert agg.ingest(v) is None


def test_same_operator_retrying_does_not_double_count():
    # If alpha retries with an updated verdict, that's one attestation slot.
    agg = FederationAggregator(ROSTER, threshold_k=2)
    agg.ingest(_verdict("alpha", confidence=8800))
    agg.ingest(_verdict("alpha", confidence=9100))
    # Only alpha attested → still below threshold.
    assert not any(b["confirmedCount"] >= 2 for b in agg.status()["activeBuckets"])


def test_independent_attack_attempts_are_isolated():
    agg = FederationAggregator(ROSTER, threshold_k=2)
    # Attack 1.
    agg.ingest(_verdict("alpha", tx_hash="0x" + "1" * 64))
    # Attack 2 (different tx hash).
    agg.ingest(_verdict("beta", tx_hash="0x" + "2" * 64))
    # Neither bucket has K confirmed yet.
    for b in agg.status()["activeBuckets"]:
        assert b["confirmedCount"] < 2


def test_status_reflects_roster_and_threshold():
    agg = FederationAggregator(ROSTER, threshold_k=2, window_seconds=30)
    s = agg.status()
    assert s["operatorIds"] == sorted(ROSTER)
    assert s["thresholdK"] == 2
    assert s["thresholdN"] == 3
    assert s["windowSeconds"] == 30
