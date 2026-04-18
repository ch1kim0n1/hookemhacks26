from __future__ import annotations
import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Optional
import redis.asyncio as redis
from .tenant_router import TenantStreamRouter

logger = logging.getLogger(__name__)
Handler = Callable[[str, dict[str, Any]], Awaitable[None]]

class StreamConsumer:
    def __init__(
        self, client: redis.Redis, *, stream: str, group: str,
        consumer_name: str, handler: Handler, block_ms: int = 5000,
        count: int = 10, auto_ack: bool = True,
        router: Optional[TenantStreamRouter] = None,
    ):
        self._client = client
        self._stream = router.resolve(stream) if router else stream
        self._group = router.resolve_group(group) if router else group
        self._consumer = consumer_name
        self._handler = handler
        self._block_ms = block_ms
        self._count = count
        self._auto_ack = auto_ack
        self._running = False

    async def start(self) -> None:
        self._running = True
        await self._ensure_group()
        await self._process_pending()
        await self._poll()

    async def stop(self) -> None:
        self._running = False

    async def ack(self, msg_id: str) -> None:
        await self._client.xack(self._stream, self._group, msg_id)

    async def _ensure_group(self) -> None:
        try:
            await self._client.xgroup_create(self._stream, self._group, id="0", mkstream=True)
        except redis.ResponseError as exc:
            if "BUSYGROUP" not in str(exc):
                raise

    async def _process_pending(self) -> None:
        while self._running:
            results = await self._client.xreadgroup(
                groupname=self._group, consumername=self._consumer,
                streams={self._stream: "0"}, count=self._count,
            )
            if not results:
                break
            messages = results[0][1]
            if not messages:
                break
            for msg_id, fields in messages:
                await self._dispatch(msg_id, fields)

    async def _poll(self) -> None:
        while self._running:
            try:
                results = await self._client.xreadgroup(
                    groupname=self._group, consumername=self._consumer,
                    streams={self._stream: ">"}, count=self._count,
                    block=self._block_ms,
                )
                if results:
                    for msg_id, fields in results[0][1]:
                        await self._dispatch(msg_id, fields)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("StreamConsumer poll error: %s", exc)
                await asyncio.sleep(1)

    async def _dispatch(self, msg_id: str, fields: dict[str, str]) -> None:
        raw = fields.get("data", "{}")
        data = json.loads(raw)
        try:
            await self._handler(msg_id, data)
            if self._auto_ack:
                await self.ack(msg_id)
        except Exception as exc:
            logger.error("StreamConsumer handler error for %s: %s", msg_id, exc)
