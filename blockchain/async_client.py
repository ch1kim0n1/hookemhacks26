"""Async JSON-RPC client for Ethereum-compatible HTTP endpoints."""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class AsyncRPCClient:
    """Async HTTP JSON-RPC client."""

    def __init__(self, rpc_url: str, timeout: float = 10.0):
        self.rpc_url = rpc_url
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> AsyncRPCClient:
        self._client = httpx.AsyncClient(timeout=self.timeout)
        return self

    async def __aexit__(self, *args: object) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def call(self, method: str, params: list[Any] | None = None) -> Any:
        if not self._client:
            raise RuntimeError("AsyncRPCClient not initialized; use 'async with'")
        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or [],
            "id": 1,
        }
        start = time.perf_counter()
        try:
            response = await self._client.post(self.rpc_url, json=payload)
            response.raise_for_status()
            data = response.json()
            if "error" in data:
                raise RuntimeError(f"RPC error: {data['error']}")
            return data.get("result")
        except httpx.TimeoutException:
            logger.error("RPC call timed out: %s", method)
            await _maybe_alert_rpc_timeout(method)
            raise
        except Exception as exc:
            logger.error("RPC call failed: %s — %s", method, exc)
            if not isinstance(exc, RuntimeError) or "RPC error" not in str(exc):
                await _maybe_alert_rpc_failure(method, str(exc))
            raise
        finally:
            try:
                from skill.observability import metrics as prom

                prom.rpc_latency.labels(method=method).observe(
                    time.perf_counter() - start
                )
            except Exception:
                pass


async def call_rpc(
    method: str,
    rpc_url: str,
    params: list[Any] | None = None,
    timeout: float = 10.0,
) -> Any:
    async with AsyncRPCClient(rpc_url, timeout) as client:
        return await client.call(method, params)


async def _maybe_alert_rpc_timeout(method: str) -> None:
    try:
        from skill.observability.alerts import AlertSeverity, alert

        await alert(
            title="RPC timeout",
            message=f"JSON-RPC timed out: {method}",
            severity=AlertSeverity.WARNING,
            tags={"method": method, "service": "blockchain"},
        )
    except Exception:
        pass


async def _maybe_alert_rpc_failure(method: str, msg: str) -> None:
    try:
        from skill.observability.alerts import AlertSeverity, alert

        await alert(
            title="RPC error",
            message=f"{method}: {msg}",
            severity=AlertSeverity.CRITICAL,
            tags={"method": method, "service": "blockchain"},
        )
    except Exception:
        pass
