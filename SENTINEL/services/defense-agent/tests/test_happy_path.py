"""Scenario A happy path — defense-agent fetches a real proof from
zk-prover before submitting verifyAndExecute."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

import defense_agent.__main__ as mod
from defense_agent.__main__ import submit_defense
from defense_agent.prover_client import ProofResult


class _FakePublisher:
    def __init__(self) -> None:
        self.published: list[tuple[str, dict]] = []

    async def publish(self, channel: str, payload: dict) -> None:
        self.published.append((channel, payload))


@pytest.mark.asyncio
async def test_happy_path_sends_real_proof_from_prover(monkeypatch) -> None:
    publisher = _FakePublisher()

    prover = MagicMock()
    prover.prove_policy.return_value = ProofResult(
        proof_hex="0xfeedface",
        public_inputs=[
            "0x" + "11" * 32,  # actionHash (will be overridden)
            "0x" + "22" * 32,  # policyHash (must match current)
            "0x" + "33" * 32,  # eventId (will be overridden)
        ],
        image_id="0xabc",
        elapsed_ms=10,
    )

    w3 = MagicMock()
    w3.eth.chain_id = 31337
    w3.eth.gas_price = 1_000_000_000
    w3.eth.get_transaction_count.return_value = 0
    tx_hash_bytes = b"\x42" * 32
    w3.eth.send_raw_transaction.return_value = tx_hash_bytes
    w3.eth.wait_for_transaction_receipt.return_value = {
        "blockNumber": 5,
        "status": 1,
    }
    # currentPolicyHash call returns bytes matching publicInputs[1].
    w3.eth.contract.return_value.functions.currentPolicyHash.return_value.call.return_value = (
        b"\x22" * 32
    )
    w3.eth.contract.return_value.functions.verifyAndExecute.return_value.build_transaction.return_value = {
        "to": "0x0",
        "gas": 0,
        "gasPrice": 0,
        "chainId": 31337,
        "nonce": 0,
    }

    addresses = {
        "PolicyRegistry": "0x" + "11" * 20,
        "PauseController": "0x" + "22" * 20,
    }
    threat = {
        "eventId": "0x" + "ab" * 32,
        "pattern": "FLASH_LOAN_ORACLE_MANIP",
        "victimProtocol": "0x" + "33" * 20,
        "confidence": 9500,
    }

    monkeypatch.setattr(mod, "_PROVER", prover)
    monkeypatch.setattr(
        mod, "load_policy_json_canonical", lambda: '{"version":1,"rules":[]}'
    )
    # Mock Account.from_key so we skip real ECDSA / tx validation.
    fake_account = MagicMock()
    fake_account.address = "0x" + "aa" * 20
    fake_account.sign_transaction.return_value = MagicMock(
        raw_transaction=b"\x00" * 10
    )
    monkeypatch.setattr(
        mod.Account, "from_key", MagicMock(return_value=fake_account)
    )

    await submit_defense(w3, addresses, publisher, threat)

    prover.prove_policy.assert_called_once()
    sent_inputs = prover.prove_policy.call_args[0][0]
    assert sent_inputs["evidence"]["pattern"] == "FLASH_LOAN_ORACLE_MANIP"
    assert sent_inputs["evidence"]["confidence"] == 9500

    channels = [c for c, _ in publisher.published]
    assert "sentinel.prover.started" in channels
    assert "sentinel.prover.finished" in channels
    assert "sentinel.defense.submitted" in channels
    assert "sentinel.defense.mined" in channels

    # The proof bytes sent on-chain must be non-empty (derived from the
    # prover response), NOT the legacy b"".
    submitted_call = (
        w3.eth.contract.return_value.functions.verifyAndExecute.call_args
    )
    assert submitted_call[0][2] != b""
    assert submitted_call[0][2] == bytes.fromhex("feedface")


@pytest.mark.asyncio
async def test_policy_hash_mismatch_emits_alert(monkeypatch) -> None:
    publisher = _FakePublisher()

    prover = MagicMock()
    prover.prove_policy.return_value = ProofResult(
        proof_hex="0xdeadbeef",
        public_inputs=[
            "0x" + "00" * 32,
            "0x" + "11" * 32,  # claim a hash that won't match the chain
            "0x" + "00" * 32,
        ],
        image_id="0x0",
        elapsed_ms=0,
    )

    w3 = MagicMock()
    w3.eth.contract.return_value.functions.currentPolicyHash.return_value.call.return_value = (
        b"\x99" * 32  # chain has something different
    )

    addresses = {
        "PolicyRegistry": "0x" + "11" * 20,
        "PauseController": "0x" + "22" * 20,
    }
    threat = {
        "eventId": "0x" + "ab" * 32,
        "pattern": "FLASH_LOAN_ORACLE_MANIP",
        "victimProtocol": "0x" + "33" * 20,
        "confidence": 9500,
    }

    monkeypatch.setattr(mod, "_PROVER", prover)
    monkeypatch.setattr(
        mod, "load_policy_json_canonical", lambda: '{"version":1,"rules":[]}'
    )

    await submit_defense(w3, addresses, publisher, threat)

    alerts = [p for c, p in publisher.published if c == "sentinel.alerts"]
    assert any("policy hash mismatch" in a["message"] for a in alerts)
    # No defense submitted.
    assert "sentinel.defense.submitted" not in [c for c, _ in publisher.published]
