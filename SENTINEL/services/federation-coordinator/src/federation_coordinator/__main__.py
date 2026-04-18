"""federation-coordinator — aggregates K-of-N operator verdicts.

Subscribes to every `sentinel.detection.operator.<id>` stream in the
configured roster, feeds each incoming `OperatorVerdict@1` envelope
through `FederationAggregator`, and publishes the resulting
`ThreatConfirmedEvent@2` to `sentinel.detection.confirmed` the moment a
bucket reaches K confirmed attestations.

Configuration (env vars):
    REDIS_URL                 redis://host:port
    FEDERATION_OPERATORS      comma-sep operator ids (default: alpha,beta,gamma)
    FEDERATION_THRESHOLD_K    int ≥ 1           (default: 2)
    FEDERATION_WINDOW_SECONDS float            (default: 60)
    HEALTH_PORT               int              (default: 9010)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import redis.asyncio as redis
import structlog
from aiohttp import web
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST, Counter

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "services" / "shared-python"))
from sentinel_streams import StreamConsumer, StreamPublisher
from .aggregator import FederationAggregator

log = structlog.get_logger()

events_in = Counter(
    "federation_verdicts_total",
    "Operator verdicts ingested",
    ["operator"],
)
events_out = Counter(
    "federation_consensus_total",
    "Consensus events emitted",
    ["pattern"],
)

REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379")
OPERATORS = [
    o.strip() for o in os.environ.get("FEDERATION_OPERATORS", "alpha,beta,gamma").split(",") if o.strip()
]
THRESHOLD_K = int(os.environ.get("FEDERATION_THRESHOLD_K", "2"))
WINDOW_SECONDS = float(os.environ.get("FEDERATION_WINDOW_SECONDS", "60"))
HEALTH_PORT = int(os.environ.get("HEALTH_PORT", "9010"))


async def start_health_server(aggregator: FederationAggregator) -> None:
    app = web.Application()

    async def health(_: web.Request) -> web.Response:
        return web.json_response({"status": "ok", **aggregator.status()})

    async def metrics(_: web.Request) -> web.Response:
        return web.Response(body=generate_latest(), content_type=CONTENT_TYPE_LATEST)

    app.router.add_get("/health", health)
    app.router.add_get("/metrics", metrics)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", HEALTH_PORT)
    await site.start()
    log.info("federation-coordinator.health", port=HEALTH_PORT)


async def main() -> None:
    aggregator = FederationAggregator(
        operator_ids=OPERATORS,
        threshold_k=THRESHOLD_K,
        window_seconds=WINDOW_SECONDS,
    )
    log.info(
        "federation-coordinator.start",
        operators=OPERATORS,
        threshold=f"{THRESHOLD_K}-of-{len(OPERATORS)}",
        window=WINDOW_SECONDS,
    )

    r_pub = redis.from_url(REDIS_URL, decode_responses=True)
    pub = StreamPublisher(r_pub)

    async def handle(msg_id: str, envelope: dict) -> None:
        operator = envelope.get("operatorId", "?")
        events_in.labels(operator=operator).inc()
        consensus = aggregator.ingest(envelope)
        if consensus is None:
            log.info(
                "federation.verdict.buffered",
                operator=operator,
                level=envelope.get("level"),
                confidence=envelope.get("confidence"),
            )
            return
        out = consensus.to_envelope()
        await pub.publish("sentinel.detection.confirmed", out)
        events_out.labels(pattern=consensus.pattern).inc()
        log.info(
            "federation.consensus",
            eventId=consensus.event_id,
            pattern=consensus.pattern,
            consensus=f"{consensus.consensus_k}/{consensus.consensus_n}",
            confidence=consensus.consensus_confidence_bp,
            attestations=[a.operator_id for a in consensus.attestations],
        )

    # One consumer per operator stream. They all feed the same aggregator —
    # which is thread-safe because asyncio is single-threaded per loop.
    consumers = []
    for op_id in OPERATORS:
        r_sub = redis.from_url(REDIS_URL, decode_responses=True)
        consumer = StreamConsumer(
            r_sub,
            stream=f"sentinel.detection.operator.{op_id}",
            group="federation-coordinator",
            consumer_name=f"federation-coordinator-{op_id}-{os.getpid()}",
            handler=handle,
        )
        consumers.append(consumer)

    await start_health_server(aggregator)
    await asyncio.gather(*(c.start() for c in consumers))


if __name__ == "__main__":
    asyncio.run(main())
