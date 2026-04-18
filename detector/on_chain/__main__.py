"""detection-engine main loop — federated-operator mode.

Each process runs as one `Operator` identified by `OPERATOR_ID` (defaults
to `default` for back-compat with the legacy single-node topology). In
federated mode the operator publishes verdicts to
`sentinel.detection.operator.<id>`; the federation-coordinator aggregates
verdicts from N operators and publishes the final
`sentinel.detection.confirmed` only when ≥K agree.

In legacy mode (`OPERATOR_ID` unset or `default`) the operator publishes
directly to `sentinel.detection.confirmed` / `sentinel.detection.candidate`
so existing tests and single-node deployments keep working unchanged.
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Any

import aiohttp
import redis.asyncio as redis
import structlog
from aiohttp import web
from eth_utils import function_signature_to_4byte_selector
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST, Counter, Histogram

from store.redis_bus import StreamConsumer, StreamPublisher
from .model_registry_client import register_if_possible
from .operator import DEFAULT_ROSTER, Operator

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
ADDRESSES_FILE = Path(
    os.environ.get("ADDRESSES_FILE", "../../config/addresses.local.json")
).resolve()

# Federation identity.
OPERATOR_ID = os.environ.get("OPERATOR_ID", "default")
_default_seed = DEFAULT_ROSTER.get(OPERATOR_ID, 42)
OPERATOR_SEED = int(os.environ.get("OPERATOR_SEED", _default_seed))

# The selector we treat as "confirmed flash-loan oracle manipulation".
ATTACK_SELECTOR = function_signature_to_4byte_selector(
    "attack(address,uint256)"
).hex()

# getReserves() selector: keccak256("getReserves()")[0:4] = 0x0902f1ac
_GET_RESERVES_SELECTOR = "0x0902f1ac"


async def fetch_oracle_price_deviation(rpc_url: str, oracle_addr: str, tx_value: str) -> float:
    """Estimate price deviation via eth_call to OraclePair.getReserves().

    Uses constant-product formula to compute how much the price would move
    if a loan equal to tx_value (or 90% of reserve0 if zero) were swapped in.
    Falls back to 5.0 on any RPC error so the state machine still progresses.
    """
    try:
        payload = {
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [{"to": oracle_addr, "data": _GET_RESERVES_SELECTOR}, "latest"],
            "id": 1,
        }
        timeout = aiohttp.ClientTimeout(total=2)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(rpc_url, json=payload) as resp:
                data = await resp.json(content_type=None)

        result = data.get("result", "")
        if not result or result == "0x" or len(result) < 130:
            return 1.0

        hex_data = result[2:]
        reserve0 = int(hex_data[:64], 16)
        reserve1 = int(hex_data[64:128], 16)

        if reserve0 == 0 or reserve1 == 0:
            return 1.0

        try:
            if isinstance(tx_value, str) and tx_value.startswith("0x"):
                amount_in = int(tx_value, 16)
            else:
                amount_in = int(str(tx_value or "0"))
        except (ValueError, TypeError):
            amount_in = 0

        if amount_in == 0:
            amount_in = reserve0 * 9 // 10

        old_price = reserve1 / reserve0
        new_reserve1 = (reserve0 * reserve1) // (reserve0 + amount_in)
        new_price = new_reserve1 / (reserve0 + amount_in)

        if old_price == 0:
            return 1.0
        return abs(new_price - old_price) / old_price * 100
    except Exception:
        return 5.0  # conservative fallback preserves existing behaviour


# Global Operator — one instance per process. Federation = N processes.
operator = Operator(operator_id=OPERATOR_ID, seed=OPERATOR_SEED)


def load_addresses() -> dict[str, str]:
    with ADDRESSES_FILE.open() as f:
        return json.load(f)


def _is_federated() -> bool:
    return OPERATOR_ID != "default"


async def handle_pending(publisher: StreamPublisher, addresses: dict[str, str], msg: dict[str, Any]) -> None:
    """Feed one mempool tx into the operator. Publishes if a verdict lands.

    In federated mode → publishes to `sentinel.detection.operator.<id>`.
    In legacy mode    → publishes to `sentinel.detection.confirmed` /
                         `sentinel.detection.candidate` directly.
    """
    tx = msg.get("tx")
    if not isinstance(tx, dict):
        return

    to = (tx.get("to") or "").lower()
    selector = (tx.get("selector") or "").lower()
    tx_from = (tx.get("from") or "").lower()

    attacker_addr = (addresses.get("FlashLoanAttacker") or "").lower()
    victim_addr = addresses.get("VictimLendingPool", "")
    flash_provider = (addresses.get("FlashLoanProvider") or "").lower()
    oracle_addr = (addresses.get("OraclePair") or "").lower()

    # Build tx feature dict for ML models.
    tx_features: dict[str, Any] = {
        "loan_amount_wei": tx.get("value", "0"),
        "price_deviation_pct": 0.0,
        "gas_price_gwei": float(tx.get("gasPrice", 20)),
        "is_known_selector": selector.endswith(ATTACK_SELECTOR),
        "to_is_oracle": bool(oracle_addr and to == oracle_addr),
    }

    # Oracle-impact lookups need the live RPC — pre-fetch once before
    # delegating to the operator (keeps the operator pure & testable).
    pre_deviation: dict[str, float] = {}
    if oracle_addr and to == oracle_addr:
        pre_deviation["value"] = await fetch_oracle_price_deviation(
            RPC_URL, oracle_addr, tx.get("value", "0")
        )

    def deviation_getter(_oracle: str, _value: str) -> float:
        return pre_deviation.get("value", 5.0)

    verdict = operator.evaluate(
        tx,
        tx_hash=tx.get("hash", ""),
        tx_from=tx_from,
        tx_features=tx_features,
        flash_provider=flash_provider,
        oracle_addr=oracle_addr,
        attacker_addr=attacker_addr,
        attack_selector=ATTACK_SELECTOR,
        price_deviation_getter=deviation_getter,
        victim_protocol=victim_addr,
        observed_at=msg.get("observedAt", ""),
    )

    if verdict is None:
        return

    # ── Federated mode: publish an OperatorVerdict on the operator's stream.
    if _is_federated():
        await publisher.publish(
            f"sentinel.detection.operator.{OPERATOR_ID}",
            verdict.to_envelope(),
        )
        events_processed.labels(
            service="detection-engine",
            channel=f"sentinel.detection.operator.{OPERATOR_ID}",
        ).inc()
        log.info(
            "operator.verdict",
            operator=OPERATOR_ID,
            level=verdict.level,
            confidence=verdict.confidence_bp,
            anomaly=round(verdict.anomaly_score, 4),
            seq=round(verdict.sequence_score, 4),
        )
        return

    # ── Legacy mode: publish directly (back-compat path).
    if verdict.level == "confirmed":
        event_id = ("0x" + uuid.uuid4().hex + "0" * 32)[:66]
        payload = {
            "schema": "ThreatConfirmedEvent@1",
            "eventId": event_id,
            "confidence": verdict.confidence_bp,
            "pattern": verdict.pattern,
            "attackerAddresses": [verdict.address],
            "victimProtocol": verdict.victim_protocol,
            "triggeringTxHashes": [verdict.triggering_tx_hash],
            "observedAtBlock": 0,
            "timestamp": verdict.observed_at,
            "observations": verdict.observations,
            "anomalyScore": round(verdict.anomaly_score, 4),
            "sequenceScore": round(verdict.sequence_score, 4),
        }
        await publisher.publish("sentinel.detection.confirmed", payload)
        events_processed.labels(
            service="detection-engine", channel="sentinel.detection.confirmed"
        ).inc()
        log.info(
            "threat.confirmed",
            event_id=event_id,
            confidence=verdict.confidence_bp,
            observations=verdict.observations,
            anomaly_score=round(verdict.anomaly_score, 4),
            seq_score=round(verdict.sequence_score, 4),
        )
    elif verdict.level == "candidate":
        payload = {
            "schema": "ThreatCandidateEvent@1",
            "confidence": verdict.confidence_bp,
            "pattern": verdict.pattern,
            "attackerAddress": verdict.address,
            "victimProtocol": verdict.victim_protocol,
            "state": verdict.state,
            "timestamp": verdict.observed_at,
        }
        await publisher.publish("sentinel.detection.candidate", payload)
        log.info("threat.candidate", confidence=verdict.confidence_bp, state=verdict.state)


async def start_health_server() -> None:
    health_port = int(os.environ.get("HEALTH_PORT", "9003"))
    app = web.Application()
    async def health(_: web.Request) -> web.Response:
        return web.json_response({
            "status": "ok",
            "operator": OPERATOR_ID,
            "seed": OPERATOR_SEED,
            "modelHash": operator.model_hash,
            "warmed": operator.warmed,
        })
    async def metrics(_: web.Request) -> web.Response:
        return web.Response(body=generate_latest(), content_type=CONTENT_TYPE_LATEST)
    app.router.add_get("/health", health)
    app.router.add_get("/metrics", metrics)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", health_port)
    await site.start()
    log.info("detection-engine.health", port=health_port, operator=OPERATOR_ID)


async def main() -> None:
    addresses = load_addresses()
    log.info(
        "detection-engine.ml.warmup",
        operator=OPERATOR_ID, seed=OPERATOR_SEED,
        msg="training operator ML models",
    )
    operator.warm_up()
    log.info(
        "detection-engine.ml.ready",
        operator=OPERATOR_ID,
        model_hash=operator.model_hash,
        federated=_is_federated(),
    )

    # Best-effort on-chain registration of this operator's model hash.
    reg = register_if_possible(
        operator_id=OPERATOR_ID,
        model_hash=operator.model_hash,
        seed=OPERATOR_SEED,
        metadata={
            "operatorId": OPERATOR_ID,
            "seed": OPERATOR_SEED,
            "features": ["loan_norm", "price_deviation_pct", "gas_price_norm",
                         "is_known_selector", "to_is_oracle"],
            "architecture": "LSTM-2x64 + IsolationForest-100",
        },
    )
    log.info(
        "detection-engine.registry",
        status=reg.status, tx=reg.tx_hash, detail=reg.detail,
    )

    r = redis.from_url(REDIS_URL, decode_responses=True)
    pub = StreamPublisher(r)

    async def on_message(msg_id: str, payload: dict) -> None:
        import time
        _start = time.monotonic()
        try:
            await handle_pending(pub, addresses, payload)
            latency_ms.labels(service="detection-engine", stage="handle_pending").observe(
                (time.monotonic() - _start) * 1000
            )
        except Exception:
            errors_total.labels(service="detection-engine", kind="handle_error").inc()
            raise

    consumer_r = redis.from_url(REDIS_URL, decode_responses=True)
    consumer = StreamConsumer(
        consumer_r,
        stream="sentinel.mempool.pending",
        group=f"detection-engine-{OPERATOR_ID}",
        consumer_name=f"detection-engine-{OPERATOR_ID}-{os.getpid()}",
        handler=on_message,
    )

    log.info(
        "detection-engine.start",
        redis=REDIS_URL,
        addresses_file=str(ADDRESSES_FILE),
        attacker=addresses.get("FlashLoanAttacker"),
        operator=OPERATOR_ID,
        federated=_is_federated(),
    )

    await start_health_server()
    await consumer.start()


if __name__ == "__main__":
    asyncio.run(main())
