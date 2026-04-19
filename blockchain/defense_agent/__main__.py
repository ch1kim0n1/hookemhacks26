"""defense-agent: receives confirmed threats, constructs a defense tx,
fetches a real PolicyCompliance proof from zk-prover, and submits via
PolicyRegistry.verifyAndExecute.

Phase 3 behaviour:
  - Happy path (pattern in PATTERN_TO_PRIMITIVE): fetch real proof,
    submit with non-empty proof bytes.
  - Unknown pattern (OPERATOR_OVERRIDE et al.): delegate to
    constraint_failure.run_constraint_failure_flow, which submits empty
    proof and catches the PolicyVerifier revert.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

import redis.asyncio as redis
import structlog
from aiohttp import web
from eth_account import Account
from eth_utils import function_signature_to_4byte_selector, keccak
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from store.redis_bus import StreamConsumer, StreamPublisher
from web3 import Web3

from .approval_gate import ApprovalGate, approval_required
from .constraint_failure import run_constraint_failure_flow
from .prover_client import (
    PolicyRuleNotFoundError,
    ProverClient,
    ProverUnavailableError,
)
from .retry import with_retry

log = structlog.get_logger()

events_processed = Counter(
    "sentinel_events_processed_total", "Total events processed", ["service", "channel"]
)
latency_ms = Histogram(
    "sentinel_latency_ms",
    "Processing latency ms",
    ["service", "stage"],
    buckets=[10, 50, 100, 250, 500, 1000, 2500, 5000],
)
errors_total = Counter(
    "sentinel_errors_total", "Total errors", ["service", "kind"]
)

REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379")
RPC_URL = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
ZK_PROVER_URL = os.environ.get("ZK_PROVER_URL", "http://127.0.0.1:9100")
POLICY_PATH = Path(
    os.environ.get("POLICY_PATH", "../../config/policy.json")
).resolve()
ADDRESSES_FILE = Path(
    os.environ.get("ADDRESSES_FILE", "../../config/addresses.local.json")
).resolve()
AGENT_KEY = os.environ.get(
    "DEFENSE_AGENT_KEY",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
)

PATTERN_TO_PRIMITIVE = {
    "FLASH_LOAN_ORACLE_MANIP": "Pause",
}

from .classifier_features import (  # noqa: E402  — keep near usage
    build_classifier_features,
)

_PROVER: ProverClient | None = None
_APPROVAL_GATE: ApprovalGate | None = None


def load_addresses() -> dict[str, str]:
    with ADDRESSES_FILE.open() as f:
        return json.load(f)


def load_policy_json_canonical() -> str:
    """Canonical policy serialization. Must match the bytes the zk
    guest hashes with sha256 to produce the policyHash journal field,
    which must in turn equal PolicyRegistry.currentPolicyHash()."""
    with POLICY_PATH.open() as f:
        raw = json.load(f)
    return json.dumps(raw, separators=(",", ":"))


def encode_pause_call(victim: str, event_id: str) -> bytes:
    """Encode PauseController.activate(target, DefenseType.Pause=1, eventId)."""
    selector = function_signature_to_4byte_selector(
        "activate(address,uint8,bytes32)"
    )
    victim_addr = bytes.fromhex(
        victim.replace("0x", "").lower().rjust(40, "0")
    )
    if len(victim_addr) != 20:
        raise ValueError(f"bad victim address: {victim}")
    padded_addr = b"\x00" * 12 + victim_addr
    padded_enum = (1).to_bytes(32, "big")
    event_bytes = bytes.fromhex(
        event_id.replace("0x", "").ljust(64, "0")
    )[:32]
    return selector + padded_addr + padded_enum + event_bytes


async def submit_defense(
    w3: Web3,
    addresses: dict[str, Any],
    publisher: StreamPublisher,
    threat: dict[str, Any],
) -> None:
    pattern = threat.get("pattern", "")
    event_id = threat.get("eventId", "")
    victim = threat.get("victimProtocol", "")

    # Unknown patterns → Scenario B rejection flow (fail-closed).
    if pattern not in PATTERN_TO_PRIMITIVE:
        log.info(
            "agent.constraint_failure.enter",
            event_id=event_id,
            pattern=pattern,
        )
        assert _PROVER is not None, "prover not initialised"
        await run_constraint_failure_flow(
            w3=w3,
            addresses=addresses,
            publisher=publisher,
            prover=_PROVER,
            agent_key=AGENT_KEY,
            threat=threat,
        )
        return

    # Human approval gate — only activates when SENTINEL_REQUIRE_APPROVAL=1
    # AND the threat clears the SENTINEL_APPROVAL_THRESHOLD confidence
    # band. Kept narrow so the headline 2.4ms detection claim still holds
    # for the automated path; the gate is an opt-in safety posture, not
    # the default execution mode.
    if _APPROVAL_GATE is not None and approval_required(
        int(threat.get("confidence", 0)) if threat.get("confidence") is not None else None
    ):
        decision = await _APPROVAL_GATE.request(threat)
        if decision.decision != "approve":
            log.info(
                "agent.approval.denied",
                event_id=event_id,
                reason=decision.note or decision.decision,
            )
            await publisher.publish(
                "sentinel.defense.rejected",
                {
                    "schema": "DefenseRejectedEvent@1",
                    "eventId": event_id,
                    "pattern": pattern,
                    "target": victim,
                    "reason": "OPERATOR_REJECTED"
                    if decision.approver != "timeout"
                    else "APPROVAL_TIMEOUT",
                    "revertReason": decision.note or "",
                    "approver": decision.approver,
                },
            )
            return
        log.info(
            "agent.approval.granted",
            event_id=event_id,
            approver=decision.approver,
        )

    account = Account.from_key(AGENT_KEY)
    pause_controller = Web3.to_checksum_address(addresses["PauseController"])
    policy_registry = Web3.to_checksum_address(addresses["PolicyRegistry"])

    action = encode_pause_call(victim, event_id)
    action_hash = keccak(
        bytes.fromhex(pause_controller.replace("0x", "")) + action
    )
    event_id_bytes = bytes.fromhex(
        event_id.replace("0x", "").ljust(64, "0")
    )[:32]

    # --- Fetch real PolicyCompliance proof ---
    assert _PROVER is not None, "prover not initialised"
    policy_json = load_policy_json_canonical()
    prove_inputs = {
        "policy_json": policy_json,
        "action": {
            "target": list(bytes.fromhex(victim.replace("0x", ""))),
            "selector": list(
                function_signature_to_4byte_selector(
                    "activate(address,uint8,bytes32)"
                )
            ),
            "calldata": list(action),
        },
        "evidence": {
            "event_id": list(event_id_bytes),
            "pattern": pattern,
            "confidence": int(threat.get("confidence", 0)),
            "victim_protocol": list(bytes.fromhex(victim.replace("0x", ""))),
            "features": build_classifier_features(threat),
        },
    }

    await publisher.publish(
        "sentinel.prover.started",
        {
            "schema": "ProofStartedEvent@1",
            "eventId": event_id,
            "circuit": "policy-compliance",
        },
    )
    try:
        # Wrap synchronous prover HTTP call with retry + exponential backoff.
        # prove_policy is sync (requests-based), so run it in the executor.
        loop = asyncio.get_event_loop()
        proof_result = await with_retry(
            lambda: loop.run_in_executor(None, _PROVER.prove_policy, prove_inputs),
            max_retries=3,
            base_delay=1.0,
            description="prove_policy",
        )
    except PolicyRuleNotFoundError:
        log.error(
            "agent.prove_policy.rejected_unexpected",
            event_id=event_id,
            pattern=pattern,
        )
        await publisher.publish(
            "sentinel.alerts",
            {
                "schema": "AlertEvent@1",
                "severity": "error",
                "message": (
                    f"happy-path proof rejected for pattern {pattern} — "
                    "policy.json missing rule or malformed."
                ),
                "eventId": event_id,
            },
        )
        return
    except ProverUnavailableError as exc:
        log.error(
            "agent.prover_unavailable",
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
    await publisher.publish(
        "sentinel.prover.finished",
        {
            "schema": "ProofFinishedEvent@1",
            "eventId": event_id,
            "status": "ok",
            "elapsedMs": proof_result.elapsed_ms,
            "cached": proof_result.cached,
            "imageId": proof_result.image_id,
        },
    )

    proof_bytes = bytes.fromhex(
        proof_result.proof_hex.removeprefix("0x")
    )
    # Normalize public inputs to 32-byte each.
    public_inputs = [
        bytes.fromhex(pi.removeprefix("0x").rjust(64, "0"))[:32]
        for pi in proof_result.public_inputs
    ]
    if len(public_inputs) < 3:
        while len(public_inputs) < 3:
            public_inputs.append(b"\x00" * 32)

    policy_contract = w3.eth.contract(
        address=policy_registry,
        abi=[
            {
                "inputs": [],
                "name": "currentPolicyHash",
                "outputs": [
                    {"internalType": "bytes32", "name": "", "type": "bytes32"}
                ],
                "stateMutability": "view",
                "type": "function",
            },
            {
                "inputs": [
                    {"internalType": "address", "name": "target", "type": "address"},
                    {"internalType": "bytes", "name": "action", "type": "bytes"},
                    {"internalType": "bytes", "name": "proof", "type": "bytes"},
                    {
                        "internalType": "bytes32[]",
                        "name": "publicInputs",
                        "type": "bytes32[]",
                    },
                ],
                "name": "verifyAndExecute",
                "outputs": [
                    {"internalType": "bool", "name": "success", "type": "bool"}
                ],
                "stateMutability": "nonpayable",
                "type": "function",
            },
        ],
    )
    current_policy_hash = policy_contract.functions.currentPolicyHash().call()
    if public_inputs[1] != current_policy_hash:
        log.error(
            "agent.policy_hash_mismatch",
            event_id=event_id,
            expected=current_policy_hash.hex(),
            actual=public_inputs[1].hex(),
        )
        await publisher.publish(
            "sentinel.alerts",
            {
                "schema": "AlertEvent@1",
                "severity": "critical",
                "message": "policy hash mismatch — DeployLocal.s.sol drift",
                "eventId": event_id,
            },
        )
        return
    # Enforce the same action-hash / eventId binding the contract does.
    public_inputs[0] = action_hash
    public_inputs[2] = event_id_bytes

    # Front-run the attacker: bump gas so anvil orders defense first.
    priority_gas = int(w3.eth.gas_price * 10)
    tx = policy_contract.functions.verifyAndExecute(
        pause_controller,
        action,
        proof_bytes,
        public_inputs,
    ).build_transaction(
        {
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address, "pending"),
            "gas": 500_000,
            "gasPrice": priority_gas,
            "chainId": w3.eth.chain_id,
        }
    )
    signed = account.sign_transaction(tx)
    raw = getattr(signed, "raw_transaction", None) or getattr(
        signed, "rawTransaction", None
    )
    # Wrap sync tx submission with retry to handle transient RPC errors.
    loop = asyncio.get_event_loop()
    tx_hash = await with_retry(
        lambda: loop.run_in_executor(None, w3.eth.send_raw_transaction, raw),
        max_retries=3,
        base_delay=1.0,
        description="send_raw_transaction",
    )
    tx_hex = tx_hash.hex() if hasattr(tx_hash, "hex") else str(tx_hash)
    if not tx_hex.startswith("0x"):
        tx_hex = "0x" + tx_hex

    await publisher.publish(
        "sentinel.defense.submitted",
        {
            "schema": "DefenseSubmittedEvent@1",
            "eventId": event_id,
            "pattern": pattern,
            "primitive": PATTERN_TO_PRIMITIVE[pattern],
            "target": victim,
            "txHash": tx_hex,
            "actionHash": "0x" + action_hash.hex(),
        },
    )
    events_processed.labels(service="defense-agent", channel="sentinel.defense.submitted").inc()
    log.info("defense.submitted", event_id=event_id, tx_hash=tx_hex)

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=15)
    await publisher.publish(
        "sentinel.defense.mined",
        {
            "schema": "DefenseMinedEvent@1",
            "eventId": event_id,
            "txHash": tx_hex,
            "blockNumber": receipt["blockNumber"],
            "status": receipt["status"],
            "proofDigest": "0x" + keccak(proof_bytes).hex(),
        },
    )
    log.info(
        "defense.mined",
        event_id=event_id,
        block=receipt["blockNumber"],
    )


async def start_health_server() -> None:
    health_port = int(os.environ.get("HEALTH_PORT", "9004"))
    app = web.Application()
    async def health(_: web.Request) -> web.Response:
        return web.json_response({"status": "ok"})
    async def metrics(_: web.Request) -> web.Response:
        return web.Response(body=generate_latest(), content_type=CONTENT_TYPE_LATEST)
    app.router.add_get("/health", health)
    app.router.add_get("/metrics", metrics)
    runner = web.AppRunner(app)
    await runner.setup()
    # Container health/metrics listener — must bind all interfaces in Docker/k8s.
    site = web.TCPSite(runner, "0.0.0.0", health_port)  # nosec B104
    await site.start()
    log.info("defense-agent.health", port=health_port)


async def main() -> None:
    global _PROVER, _APPROVAL_GATE
    _PROVER = ProverClient(base_url=ZK_PROVER_URL)
    addresses = load_addresses()
    w3 = Web3(Web3.HTTPProvider(RPC_URL))

    r = redis.from_url(REDIS_URL, decode_responses=True)
    pub = StreamPublisher(r)

    if os.environ.get("SENTINEL_REQUIRE_APPROVAL", "0") in ("1", "true", "yes"):
        timeout_s = float(os.environ.get("SENTINEL_APPROVAL_TIMEOUT_S", "90"))
        _APPROVAL_GATE = ApprovalGate(REDIS_URL, pub, timeout_seconds=timeout_s)
        await _APPROVAL_GATE.start()
        log.info("agent.approval_gate.enabled", timeout_s=timeout_s)

    async def on_threat(msg_id: str, threat: dict) -> None:
        import time
        _start = time.monotonic()
        try:
            await submit_defense(w3, addresses, pub, threat)
            latency_ms.labels(service="defense-agent", stage="submit_defense").observe(
                (time.monotonic() - _start) * 1000
            )
        except Exception as exc:
            errors_total.labels(service="defense-agent", kind="submit_error").inc()
            log.error("submit.failed", err=str(exc), event_id=threat.get("eventId"))

    consumer_r = redis.from_url(REDIS_URL, decode_responses=True)
    consumer = StreamConsumer(
        consumer_r,
        stream="sentinel.detection.confirmed",
        group="defense-agent",
        consumer_name=f"defense-agent-{os.getpid()}",
        handler=on_threat,
    )

    log.info("defense-agent.start", rpc=RPC_URL, prover=ZK_PROVER_URL, addresses_file=str(ADDRESSES_FILE))
    await start_health_server()
    await consumer.start()


if __name__ == "__main__":
    asyncio.run(main())
