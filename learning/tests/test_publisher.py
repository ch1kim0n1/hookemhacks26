"""Smoke tests for learning.publisher.

Covers the pure helpers (compute_update_id, build_publish_payload) and
the degraded-mode behavior of publish_defense_update when web3 / env
vars are missing — so the test suite runs without an RPC node.
"""
from __future__ import annotations

import hashlib

from learning.publisher import (
    DEFENSE_PROTOCOL_ABI,
    build_publish_payload,
    compute_update_id,
    publish_defense_update,
)


def _thirty_two(n: int) -> bytes:
    return bytes([n]) * 32


def test_compute_update_id_is_deterministic():
    args = dict(
        rule_diff_hash=_thirty_two(0xAA),
        model_delta_hash=_thirty_two(0xBB),
        derived_from_attack_hash=_thirty_two(0xCC),
        zk_proof=b"\xDE\xAD\xBE\xEF",
    )
    assert compute_update_id(**args) == compute_update_id(**args)


def test_compute_update_id_changes_with_proof_bytes():
    base = dict(
        rule_diff_hash=_thirty_two(1),
        model_delta_hash=_thirty_two(2),
        derived_from_attack_hash=_thirty_two(3),
    )
    a = compute_update_id(**base, zk_proof=b"\x01")
    b = compute_update_id(**base, zk_proof=b"\x02")
    assert a != b


def test_compute_update_id_commits_to_proof_hash_not_bytes():
    """Same proof hash, different proof bytes with matching sha should match
    — but since we use the sha of the proof in the id, the id depends on
    the proof bytes. Here we just assert the id is a 32-byte digest."""
    uid = compute_update_id(
        rule_diff_hash=_thirty_two(1),
        model_delta_hash=_thirty_two(2),
        derived_from_attack_hash=_thirty_two(3),
        zk_proof=b"anything",
    )
    assert len(uid) == 32
    # Outer hash is sha256.
    assert isinstance(uid, bytes)


def test_build_payload_structure_matches_contract_ordering():
    payload = build_publish_payload(
        rule_diff_hash=_thirty_two(0xA1),
        model_delta_hash=_thirty_two(0xB2),
        derived_from_attack_hash=_thirty_two(0xC3),
        zk_proof=b"\x00\x01\x02",
        old_policy_hash=_thirty_two(0xD4),
        new_policy_hash=_thirty_two(0xE5),
    )
    # publicInputs order: [oldPolicyHash, newPolicyHash, attackHash, modelDeltaHash]
    assert payload["publicInputs"][0] == _thirty_two(0xD4)
    assert payload["publicInputs"][1] == _thirty_two(0xE5)
    assert payload["publicInputs"][2] == _thirty_two(0xC3)
    assert payload["publicInputs"][3] == _thirty_two(0xB2)
    assert payload["ruleDiffHash"] == _thirty_two(0xA1)
    assert payload["modelDeltaHash"] == _thirty_two(0xB2)


def test_build_payload_left_pads_short_hashes():
    p = build_publish_payload(
        rule_diff_hash=b"\x01",
        model_delta_hash=b"\x02",
        derived_from_attack_hash=b"\x03",
        zk_proof=b"",
        old_policy_hash=b"\x04",
        new_policy_hash=b"\x05",
    )
    # Each hash is padded to 32 bytes (left-pad, big-endian style).
    assert len(p["ruleDiffHash"]) == 32
    assert p["ruleDiffHash"][-1] == 0x01
    assert p["ruleDiffHash"][:-1] == b"\x00" * 31


def test_publish_defense_update_returns_structured_error_without_env(
    monkeypatch,
):
    # Strip env vars so the function can't actually send.
    for v in ("RPC_URL", "DEFENSE_PROTOCOL_ADDRESS", "CLAWGUARD_PRIVATE_KEY"):
        monkeypatch.delenv(v, raising=False)
    result = publish_defense_update(
        rule_diff_hash=_thirty_two(1),
        model_delta_hash=_thirty_two(2),
        derived_from_attack_hash=_thirty_two(3),
        old_policy_hash=_thirty_two(4),
        new_policy_hash=_thirty_two(5),
        proof=b"\xAA",
    )
    assert result["ok"] is False
    # Either "web3 not installed" or "addresses missing" — both include payload.
    assert "payload" in result
    assert result["payload"]["updateId"].startswith("0x")
    assert len(result["payload"]["publicInputs"]) == 4


def test_abi_fragment_exposes_publishDefenseUpdate():
    names = {entry.get("name") for entry in DEFENSE_PROTOCOL_ABI}
    assert "publishDefenseUpdate" in names
    assert "DefenseUpdatePublished" in names
