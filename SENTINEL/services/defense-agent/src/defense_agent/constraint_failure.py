"""Scenario B — Fail-Closed (Agent Constraint Failure).

The agent constructs a defense action for a pattern with no policy rule
(e.g. OPERATOR_OVERRIDE), asks zk-prover for a PolicyCompliance proof,
receives 422, then submits verifyAndExecute with EMPTY proof bytes so
that PolicyVerifier (which rejects empty under Phase 3A) causes
PolicyRegistry to revert with INVALID_PROOF. That revert is the visible
demo moment — SENTINEL fails closed. Not a timeout, not a fallback: a
cryptographic refusal. If the zkVM cannot produce a proof, no defense
tx lands.

The rejection event is published so the api-gateway can fan it out as a
TRUST_COLLAPSE_CUE with state=REJECTED.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import redis.asyncio as redis
import structlog
from eth_account import Account
from eth_utils import function_signature_to_4byte_selector, keccak
from web3 import Web3
from web3.exceptions import ContractLogicError

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "services" / "shared-python"))
from sentinel_streams import StreamPublisher

from .prover_client import (
    PolicyRuleNotFoundError,
    ProverClient,
    ProverUnavailableError,
)

log = structlog.get_logger()


def _encode_pause_call(victim: str, event_id: str) -> bytes:
    selector = function_signature_to_4byte_selector(
        "activate(address,uint8,bytes32)"
    )
    victim_addr = bytes.fromhex(
        victim.replace("0x", "").lower().rjust(40, "0")
    )
    padded_addr = b"\x00" * 12 + victim_addr[-20:]
    padded_enum = (1).to_bytes(32, "big")  # DefenseType.Pause
    event_bytes = bytes.fromhex(
        event_id.replace("0x", "").ljust(64, "0")
    )[:32]
    return selector + padded_addr + padded_enum + event_bytes


async def run_constraint_failure_flow(
    *,
    w3: Web3,
    addresses: dict[str, Any],
    publisher: StreamPublisher,
    prover: ProverClient,
    agent_key: str,
    threat: dict[str, Any],
) -> None:
    event_id = threat["eventId"]
    victim = threat["victimProtocol"]
    pattern = threat["pattern"]

    pause_controller = Web3.to_checksum_address(addresses["PauseController"])
    policy_registry = Web3.to_checksum_address(addresses["PolicyRegistry"])

    action = _encode_pause_call(victim, event_id)
    action_hash = keccak(
        bytes.fromhex(pause_controller.replace("0x", "")) + action
    )
    event_id_bytes = bytes.fromhex(
        event_id.replace("0x", "").ljust(64, "0")
    )[:32]

    # 1. Ask the prover. Expect 422 for unknown patterns.
    proof_bytes = b""
    try:
        prover.prove_policy(
            {
                "actionHash": "0x" + action_hash.hex(),
                "eventId": event_id,
                "pattern": pattern,
                "victimProtocol": victim,
                "confidence": threat.get("confidence", 0),
            }
        )
    except PolicyRuleNotFoundError:
        log.info(
            "constraint_failure.prover_rejected",
            event_id=event_id,
            pattern=pattern,
        )
        await publisher.publish(
            "sentinel.prover.finished",
            {
                "schema": "ProofFinishedEvent@1",
                "eventId": event_id,
                "status": "failed",
                "reason": "POLICY_RULE_NOT_FOUND",
            },
        )
    except ProverUnavailableError as exc:
        log.error(
            "constraint_failure.prover_unavailable",
            err=str(exc),
            event_id=event_id,
        )
        await publisher.publish(
            "sentinel.alerts",
            {
                "schema": "AlertEvent@1",
                "severity": "error",
                "message": f"prover unavailable: {exc}",
                "eventId": event_id,
            },
        )
        return

    # 2. Read current policy hash for public inputs.
    current_policy_hash = (
        w3.eth.contract(
            address=policy_registry,
            abi=[
                {
                    "inputs": [],
                    "name": "currentPolicyHash",
                    "outputs": [{"type": "bytes32"}],
                    "stateMutability": "view",
                    "type": "function",
                },
            ],
        )
        .functions.currentPolicyHash()
        .call()
    )

    # 3. Submit verifyAndExecute with empty proof — expected to revert.
    account = Account.from_key(agent_key)
    public_inputs = [action_hash, current_policy_hash, event_id_bytes]

    policy_contract = w3.eth.contract(
        address=policy_registry,
        abi=[
            {
                "inputs": [
                    {"type": "address", "name": "target"},
                    {"type": "bytes", "name": "action"},
                    {"type": "bytes", "name": "proof"},
                    {"type": "bytes32[]", "name": "publicInputs"},
                ],
                "name": "verifyAndExecute",
                "outputs": [{"type": "bool"}],
                "stateMutability": "nonpayable",
                "type": "function",
            },
        ],
    )
    tx = policy_contract.functions.verifyAndExecute(
        pause_controller, action, proof_bytes, public_inputs
    ).build_transaction(
        {
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address, "pending"),
            "gas": 500_000,
            "gasPrice": w3.eth.gas_price,
            "chainId": w3.eth.chain_id,
        }
    )
    signed = account.sign_transaction(tx)
    raw = getattr(signed, "raw_transaction", None) or getattr(
        signed, "rawTransaction", None
    )

    await publisher.publish(
        "sentinel.defense.submitted",
        {
            "schema": "DefenseSubmittedEvent@1",
            "eventId": event_id,
            "pattern": pattern,
            "primitive": "Pause",
            "target": victim,
            "txHash": "0x" + "00" * 32,
            "actionHash": "0x" + action_hash.hex(),
            "scenario": "constraint_failure",
        },
    )

    try:
        tx_hash = w3.eth.send_raw_transaction(raw)
    except ContractLogicError as exc:
        # Some providers surface reverts during send (pre-flight estimate).
        await _publish_rejected(publisher, event_id, pattern, victim, str(exc))
        return
    except Exception as exc:
        msg = str(exc)
        if "revert" in msg.lower() or "invalid proof" in msg.lower():
            await _publish_rejected(publisher, event_id, pattern, victim, msg)
            return
        await publisher.publish(
            "sentinel.alerts",
            {
                "schema": "AlertEvent@1",
                "severity": "error",
                "message": f"constraint_failure send exception: {msg}",
                "eventId": event_id,
            },
        )
        return

    # The send succeeded but we must wait for the receipt to observe
    # the revert — PolicyVerifier rejection surfaces at mine time, not
    # send time.
    try:
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=15)
    except Exception as exc:
        await publisher.publish(
            "sentinel.alerts",
            {
                "schema": "AlertEvent@1",
                "severity": "error",
                "message": f"constraint_failure receipt timeout: {exc}",
                "eventId": event_id,
            },
        )
        return

    if receipt["status"] == 0:
        # Empty-proof submission with a valid policy hash on our Phase 3
        # PolicyVerifier (reject-empty) can only revert with
        # "PolicyRegistry: invalid proof". We don't need to re-run
        # eth_call — the revert reason is deterministic here.
        await _publish_rejected(
            publisher,
            event_id,
            pattern,
            victim,
            "execution reverted: PolicyRegistry: invalid proof",
        )
        return

    # If the tx did NOT revert, something is wrong (PolicyVerifier bug).
    await publisher.publish(
        "sentinel.alerts",
        {
            "schema": "AlertEvent@1",
            "severity": "critical",
            "message": (
                "Scenario B submitted empty proof and the chain "
                "ACCEPTED it — PolicyVerifier is misconfigured."
            ),
            "eventId": event_id,
        },
    )


async def _publish_rejected(
    publisher: StreamPublisher,
    event_id: str,
    pattern: str,
    victim: str,
    msg: str,
) -> None:
    reason = "INVALID_PROOF"
    low = msg.lower()
    if "stale policy" in low:
        reason = "STALE_POLICY"
    elif "not agent" in low:
        reason = "NOT_AGENT"
    elif "action mismatch" in low:
        reason = "ACTION_MISMATCH"
    await publisher.publish(
        "sentinel.defense.rejected",
        {
            "schema": "DefenseRejectedEvent@1",
            "eventId": event_id,
            "pattern": pattern,
            "target": victim,
            "reason": reason,
            "revertReason": msg,
        },
    )
    log.info(
        "constraint_failure.reverted", event_id=event_id, reason=reason
    )
