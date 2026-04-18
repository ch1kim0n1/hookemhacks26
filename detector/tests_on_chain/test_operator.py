"""Unit tests for the federated Operator class."""
from __future__ import annotations

import pytest

from detector.on_chain.operator import DEFAULT_ROSTER, Operator


ATTACKER = "0x0116686e2291dbd5e317f47fadbfb43b599786ef"
VICTIM = "0x9a676e781a523b5d0c0e43731313a708cb607508"
FLASH_PROVIDER = "0x0dcd1bf9a1b36ce34237eeafef220932846bcd82"
ORACLE = "0xa51c1fc2f0d1a1b8494ed1fe312d7c3a78ed91c0"
ATTACKER_EOA = "0x742d35cc6634c0532925a3b844bc9e7595f0beb4"
ATTACK_SELECTOR = "52fba25c"  # bare hex (no 0x)


def _mk_op(op_id: str, seed: int) -> Operator:
    op = Operator(operator_id=op_id, seed=seed)
    # Small training budget keeps the test quick (~1–2 s).
    op.warm_up(n_normal=100, n_attack=80, n_seq_normal=200)
    return op


def _constant_deviation(value: float):
    def getter(_oracle, _value):
        return value
    return getter


def _flash_tx(hash_: str) -> dict:
    return {
        "hash": hash_, "from": ATTACKER_EOA, "to": FLASH_PROVIDER,
        "selector": "0xab9c4b5d", "value": str(10 ** 24), "gasPrice": 45,
    }


def _oracle_tx(hash_: str) -> dict:
    return {
        "hash": hash_, "from": ATTACKER_EOA, "to": ORACLE,
        "selector": "0x022c0d9f", "value": str(9 * 10 ** 23), "gasPrice": 52,
    }


def _exploit_tx(hash_: str) -> dict:
    return {
        "hash": hash_, "from": ATTACKER_EOA, "to": ATTACKER,
        "selector": "0x" + ATTACK_SELECTOR, "value": "0", "gasPrice": 89,
    }


def _features_of(tx: dict) -> dict:
    selector = (tx.get("selector") or "").lower()
    to = (tx.get("to") or "").lower()
    return {
        "loan_amount_wei": tx.get("value", "0"),
        "price_deviation_pct": 0.0,
        "gas_price_gwei": float(tx.get("gasPrice", 20)),
        "is_known_selector": selector.endswith(ATTACK_SELECTOR),
        "to_is_oracle": to == ORACLE,
    }


def _run(op, tx, deviation=5.0):
    return op.evaluate(
        tx,
        tx_hash=tx["hash"],
        tx_from=tx["from"],
        tx_features=_features_of(tx),
        flash_provider=FLASH_PROVIDER,
        oracle_addr=ORACLE,
        attacker_addr=ATTACKER,
        attack_selector=ATTACK_SELECTOR,
        price_deviation_getter=_constant_deviation(deviation),
        victim_protocol=VICTIM,
        observed_at="2026-04-17T00:00:00Z",
    )


# ──────────────────────────────────────────────────────────────────────
# lifecycle + identity
# ──────────────────────────────────────────────────────────────────────
def test_default_roster_has_three_canonical_operators():
    assert set(DEFAULT_ROSTER.keys()) == {"alpha", "beta", "gamma"}
    # Seeds are distinct — the whole point of federation.
    assert len(set(DEFAULT_ROSTER.values())) == 3


def test_operator_id_required():
    with pytest.raises(ValueError):
        Operator(operator_id="", seed=1)


def test_model_hash_zero_before_warm_up():
    op = Operator(operator_id="alpha", seed=1337)
    assert op.model_hash == "0x" + "0" * 64
    assert op.warmed is False


def test_model_hash_deterministic_per_seed():
    a1 = _mk_op("alpha", 1337)
    a2 = _mk_op("alpha", 1337)
    assert a1.model_hash == a2.model_hash
    # Valid hex digest + 0x prefix.
    assert a1.model_hash.startswith("0x")
    assert len(a1.model_hash) == 66


def test_model_hash_differs_across_seeds():
    a = _mk_op("alpha", 1337)
    b = _mk_op("beta", 4242)
    c = _mk_op("gamma", 9001)
    hashes = {a.model_hash, b.model_hash, c.model_hash}
    assert len(hashes) == 3, f"expected 3 distinct hashes, got {hashes}"


def test_model_hash_differs_on_id_with_same_seed():
    # Same seed, different id → different hash (id is part of the digest).
    a = _mk_op("alpha", 1337)
    b = _mk_op("beta", 1337)
    assert a.model_hash != b.model_hash


# ──────────────────────────────────────────────────────────────────────
# detection behaviour
# ──────────────────────────────────────────────────────────────────────
def test_before_warmup_still_catches_by_selector():
    # Unwarmed operator falls back to selector-match alone — which is
    # still enough for the state-machine direct-exploit branch.
    op = Operator(operator_id="alpha", seed=1337)
    verdict = _run(op, _exploit_tx("0xabc"))
    assert verdict is not None
    assert verdict.level == "confirmed"
    # Model hash is zero because no weights exist yet — federation-
    # verifier will correctly reject this on-chain (unregistered model).
    assert verdict.model_hash == "0x" + "0" * 64


def test_full_kill_chain_produces_confirmed_verdict():
    op = _mk_op("alpha", 1337)
    # Flash loan and oracle don't publish (non-terminal transitions).
    assert _run(op, _flash_tx("0xh1")) is None
    assert _run(op, _oracle_tx("0xh2"), deviation=47.3) is None
    # Exploit call is the only path that yields a verdict.
    verdict = _run(op, _exploit_tx("0xh3"))
    assert verdict is not None
    assert verdict.operator_id == "alpha"
    assert verdict.level == "confirmed"
    assert verdict.confidence_bp >= 8500
    assert verdict.triggering_tx_hash == "0xh3"
    assert verdict.pattern == "FLASH_LOAN_ORACLE_MANIP"
    assert verdict.victim_protocol == VICTIM
    assert verdict.model_hash.startswith("0x")


def test_direct_exploit_still_confirms_at_0_9():
    # Stealth scenario: no prior observations, exploit selector alone.
    op = _mk_op("alpha", 1337)
    verdict = _run(op, _exploit_tx("0xh1"))
    assert verdict is not None
    assert verdict.level == "confirmed"
    # IDLE→CONFIRMED path hardcodes 0.9 confidence.
    assert verdict.confidence_bp >= 8500


def test_non_exploit_tx_returns_none():
    op = _mk_op("alpha", 1337)
    transfer_tx = {
        "hash": "0xh1", "from": "0x0000000000000000000000000000000000000001",
        "to": "0x0000000000000000000000000000000000000002",
        "selector": "0xa9059cbb", "value": "0", "gasPrice": 20,
    }
    assert _run(op, transfer_tx) is None


def test_envelope_shape_matches_schema():
    op = _mk_op("alpha", 1337)
    v = _run(op, _exploit_tx("0xdeadbeef"))
    envelope = v.to_envelope()
    assert envelope["schema"] == "OperatorVerdict@1"
    for k in ("operatorId", "modelHash", "address", "state", "level",
              "confidence", "anomalyScore", "sequenceScore", "triggeringTxHash",
              "pattern", "victimProtocol"):
        assert k in envelope, f"missing {k}"
    assert envelope["modelHash"].startswith("0x")
    assert 0 <= envelope["confidence"] <= 10_000
    assert envelope["level"] in {"noise", "candidate", "confirmed"}


# ──────────────────────────────────────────────────────────────────────
# federation diversity
# ──────────────────────────────────────────────────────────────────────
def test_three_operators_independently_confirm_same_attack():
    ops = [_mk_op(op_id, seed) for op_id, seed in DEFAULT_ROSTER.items()]

    verdicts = []
    # Each operator sees the same kill-chain independently.
    for op in ops:
        _run(op, _flash_tx("0xh1"))
        _run(op, _oracle_tx("0xh2"), deviation=47.3)
        v = _run(op, _exploit_tx("0xh3"))
        verdicts.append(v)

    # Every operator should independently reach `confirmed`.
    assert all(v is not None and v.level == "confirmed" for v in verdicts), (
        [f"{v.operator_id}:{v.level}" if v else "None" for v in verdicts]
    )
    # Each operator's model hash is unique.
    assert len({v.model_hash for v in verdicts}) == 3
    # But they all point at the same attack attempt.
    assert len({v.triggering_tx_hash for v in verdicts}) == 1
    assert len({v.address for v in verdicts}) == 1
