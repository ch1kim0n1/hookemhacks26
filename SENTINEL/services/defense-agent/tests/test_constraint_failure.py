"""Scenario B — agent asks for a proof it can't get, then submits
empty bytes to the on-chain verifier to produce the visible reject."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest
from web3.exceptions import ContractLogicError

import defense_agent.constraint_failure as cf_mod
from defense_agent.constraint_failure import run_constraint_failure_flow
from defense_agent.prover_client import PolicyRuleNotFoundError


class _FakePublisher:
    def __init__(self) -> None:
        self.published: list[tuple[str, dict]] = []

    async def publish(self, channel: str, payload: dict) -> None:
        self.published.append((channel, payload))


def _make_w3_revert(msg: str) -> MagicMock:
    w3 = MagicMock()
    w3.eth.chain_id = 31337
    w3.eth.gas_price = 1_000_000_000
    w3.eth.get_transaction_count.return_value = 0
    w3.eth.send_raw_transaction.side_effect = ContractLogicError(msg)
    w3.eth.contract.return_value.functions.currentPolicyHash.return_value.call.return_value = (
        b"\x00" * 32
    )
    w3.eth.contract.return_value.functions.verifyAndExecute.return_value.build_transaction.return_value = {
        "to": "0x0",
        "gas": 0,
        "gasPrice": 0,
        "chainId": 31337,
        "nonce": 0,
    }
    return w3


@pytest.fixture(autouse=True)
def _mock_account(monkeypatch):
    """Mock Account.from_key in the constraint_failure module so tests
    don't exercise real tx-signing paths (the mocked tx is a stub)."""
    fake_account = MagicMock()
    fake_account.address = "0x" + "aa" * 20
    fake_account.sign_transaction.return_value = MagicMock(
        raw_transaction=b"\x00" * 10
    )
    monkeypatch.setattr(
        cf_mod.Account, "from_key", MagicMock(return_value=fake_account)
    )


@pytest.mark.asyncio
async def test_publishes_rejected_when_prover_returns_422_and_chain_reverts() -> None:
    publisher = _FakePublisher()

    prover = MagicMock()
    prover.prove_policy.side_effect = PolicyRuleNotFoundError(
        "POLICY_RULE_NOT_FOUND"
    )

    w3 = _make_w3_revert("execution reverted: PolicyRegistry: invalid proof")

    addresses = {
        "PolicyRegistry": "0x" + "11" * 20,
        "PauseController": "0x" + "22" * 20,
    }
    threat = {
        "eventId": "0x" + "ab" * 32,
        "pattern": "OPERATOR_OVERRIDE",
        "victimProtocol": "0x" + "33" * 20,
        "confidence": 10000,
    }

    await run_constraint_failure_flow(
        w3=w3,
        addresses=addresses,
        publisher=publisher,
        prover=prover,
        agent_key=(
            "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
        ),
        threat=threat,
    )

    channels = [c for c, _ in publisher.published]
    assert "sentinel.defense.submitted" in channels
    assert "sentinel.defense.rejected" in channels
    rejected = [
        p for c, p in publisher.published if c == "sentinel.defense.rejected"
    ][0]
    assert rejected["reason"] == "INVALID_PROOF"
    assert rejected["eventId"] == threat["eventId"]


@pytest.mark.asyncio
async def test_alert_on_unexpected_non_revert() -> None:
    """If empty-proof somehow succeeds, emit a critical alert — that's
    a PolicyVerifier misconfiguration."""
    publisher = _FakePublisher()

    prover = MagicMock()
    prover.prove_policy.side_effect = PolicyRuleNotFoundError("nope")

    w3 = MagicMock()
    w3.eth.chain_id = 31337
    w3.eth.gas_price = 1_000_000_000
    w3.eth.get_transaction_count.return_value = 0
    w3.eth.send_raw_transaction.return_value = b"\x11" * 32
    w3.eth.contract.return_value.functions.currentPolicyHash.return_value.call.return_value = (
        b"\x00" * 32
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
        "pattern": "OPERATOR_OVERRIDE",
        "victimProtocol": "0x" + "33" * 20,
        "confidence": 10000,
    }

    await run_constraint_failure_flow(
        w3=w3,
        addresses=addresses,
        publisher=publisher,
        prover=prover,
        agent_key=(
            "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
        ),
        threat=threat,
    )

    alerts = [p for c, p in publisher.published if c == "sentinel.alerts"]
    assert any(a.get("severity") == "critical" for a in alerts)
