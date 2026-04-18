from __future__ import annotations
import json
from typing import Any, Optional
import redis.asyncio as redis
from .tenant_router import TenantStreamRouter

class StreamPublisher:
    def __init__(
        self, client: redis.Redis, *, max_len: int = 10_000,
        router: Optional[TenantStreamRouter] = None,
    ):
        self._client = client
        self._max_len = max_len
        self._router = router

    async def publish(self, stream: str, data: dict[str, Any]) -> str:
        resolved_stream = self._router.resolve(stream) if self._router else stream
        msg_id: str = await self._client.xadd(
            resolved_stream,
            {"data": json.dumps(data)},
            maxlen=self._max_len,
            approximate=False,
        )
        return msg_id
