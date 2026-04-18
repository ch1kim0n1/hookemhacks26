"""Human-in-the-loop approval gate.

When SENTINEL_REQUIRE_APPROVAL=1, the defense agent pauses high-
confidence threats before submitting verifyAndExecute and waits for an
operator decision. The operator releases the gate via
`POST /api/v1/approvals/:eventId/approve` on api-gateway, which
publishes a DefenseApprovalEvent to sentinel.defense.approval.

This module exposes:
  - ApprovalGate.request(event_id, threat): publishes
    sentinel.defense.pending_approval and suspends the caller until the
    matching approval arrives or the timeout fires.
  - ApprovalGate.start(): spawns a background task that consumes
    sentinel.defense.approval and wakes the suspended request.

Kept intentionally in-memory — if the agent crashes, the pending
defense is abandoned rather than held in a half-committed state. A
reboot re-subscribes to sentinel.detection.confirmed and picks up
unprocessed threats from the consumer-group pending list.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any

import redis.asyncio as redis
import structlog

from store.redis_bus import StreamConsumer, StreamPublisher

log = structlog.get_logger()


@dataclass
class ApprovalDecision:
    decision: str  # "approve" | "reject"
    approver: str
    decided_at: str
    note: str | None


def approval_required(confidence: int | None) -> bool:
    """Returns True if the current threat should be gated on a human
    decision. The threshold is configurable so ops can be strict in
    prod (e.g. every release gated) and permissive in demo (e.g. only
    high-confidence releases gated)."""
    if os.environ.get("SENTINEL_REQUIRE_APPROVAL", "0") not in ("1", "true", "yes"):
        return False
    try:
        threshold = int(os.environ.get("SENTINEL_APPROVAL_THRESHOLD", "9500"))
    except ValueError:
        threshold = 9500
    return (confidence or 0) >= threshold


class ApprovalGate:
    def __init__(
        self,
        redis_url: str,
        publisher: StreamPublisher,
        *,
        timeout_seconds: float = 90.0,
    ) -> None:
        self._redis_url = redis_url
        self._publisher = publisher
        self._timeout = timeout_seconds
        # eventId → (asyncio.Event, decision container). Container is a
        # list so the consumer task can assign into it by reference.
        self._pending: dict[str, tuple[asyncio.Event, list[ApprovalDecision]]] = {}
        self._consumer: StreamConsumer | None = None
        self._consumer_redis: redis.Redis | None = None

    async def start(self) -> None:
        """Spin up the approval-stream consumer. Call once per process."""
        self._consumer_redis = redis.from_url(self._redis_url, decode_responses=True)
        self._consumer = StreamConsumer(
            self._consumer_redis,
            stream="sentinel.defense.approval",
            group="defense-agent-approval",
            consumer_name=f"defense-agent-approval-{os.getpid()}",
            handler=self._on_decision,
        )
        # StreamConsumer.start() blocks; run in the background.
        asyncio.create_task(self._consumer.start())
        log.info("approval_gate.start", timeout_s=self._timeout)

    async def _on_decision(self, _msg_id: str, data: dict[str, Any]) -> None:
        event_id = str(data.get("eventId", ""))
        slot = self._pending.get(event_id)
        if not slot:
            # No one is waiting — either already timed out or never
            # requested. Drop silently; the HTTP responder is the
            # source of truth for the UI.
            return
        waiter, container = slot
        container.append(
            ApprovalDecision(
                decision=str(data.get("decision", "reject")),
                approver=str(data.get("approver", "unknown")),
                decided_at=str(data.get("decidedAt", "")),
                note=(data.get("note") if data.get("note") else None),
            )
        )
        waiter.set()

    async def request(self, threat: dict[str, Any]) -> ApprovalDecision:
        """Publish pending_approval, block until decision or timeout.

        On timeout we synthesise a `reject` decision so the caller
        always gets an ApprovalDecision back — the tx never lands
        without an explicit approval, which is the whole point of the
        fail-closed posture.
        """
        event_id = str(threat.get("eventId", ""))
        if not event_id:
            raise ValueError("approval_gate.request requires eventId")

        waiter = asyncio.Event()
        container: list[ApprovalDecision] = []
        self._pending[event_id] = (waiter, container)
        try:
            await self._publisher.publish(
                "sentinel.defense.pending_approval",
                {
                    "schema": "DefensePendingApprovalEvent@1",
                    "eventId": event_id,
                    "pattern": threat.get("pattern"),
                    "confidence": threat.get("confidence"),
                    "victimProtocol": threat.get("victimProtocol"),
                    "timeoutSeconds": self._timeout,
                },
            )
            log.info("approval_gate.pending", event_id=event_id)
            try:
                await asyncio.wait_for(waiter.wait(), timeout=self._timeout)
            except asyncio.TimeoutError:
                log.info("approval_gate.timeout", event_id=event_id)
                return ApprovalDecision(
                    decision="reject",
                    approver="timeout",
                    decided_at="",
                    note=f"no decision within {self._timeout:.0f}s",
                )
            return container[0]
        finally:
            self._pending.pop(event_id, None)
