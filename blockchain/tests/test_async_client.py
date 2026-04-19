"""Async JSON-RPC client."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from blockchain.async_client import AsyncRPCClient, call_rpc


class _FakeResponse:
    def __init__(self, data: dict):
        self._data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


@pytest.mark.asyncio
async def test_async_rpc_client_makes_call():
    mock_response = {"jsonrpc": "2.0", "result": "0x123", "id": 1}

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = _FakeResponse(mock_response)
        async with AsyncRPCClient("http://localhost:8545") as client:
            result = await client.call("eth_blockNumber")
        assert result == "0x123"


@pytest.mark.asyncio
async def test_async_rpc_client_raises_on_error():
    mock_response = {
        "jsonrpc": "2.0",
        "error": {"code": -32000, "message": "Something went wrong"},
        "id": 1,
    }
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = _FakeResponse(mock_response)
        async with AsyncRPCClient("http://localhost:8545") as client:
            with pytest.raises(RuntimeError, match="RPC error"):
                await client.call("eth_blockNumber")


@pytest.mark.asyncio
async def test_call_rpc_convenience_function():
    mock_response = {"jsonrpc": "2.0", "result": "0x456", "id": 1}
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = _FakeResponse(mock_response)
        result = await call_rpc("eth_blockNumber", "http://localhost:8545")
    assert result == "0x456"


@pytest.mark.asyncio
async def test_async_rpc_timeout():
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.TimeoutException("timeout")
        async with AsyncRPCClient("http://localhost:8545", timeout=1.0) as client:
            with pytest.raises(httpx.TimeoutException):
                await client.call("eth_blockNumber")


# --- Alert severity + dedupe ---------------------------------------------


def test_critical_marker_classification():
    from blockchain.async_client import _is_critical_rpc_error

    assert _is_critical_rpc_error("connection refused by peer")
    assert _is_critical_rpc_error("Temporary failure in name resolution")
    assert _is_critical_rpc_error("SSL handshake failed")
    # Typical RPC-level errors are NOT critical — they are warnings.
    assert not _is_critical_rpc_error("insufficient funds for gas")
    assert not _is_critical_rpc_error("invalid method eth_foo")


def test_alert_dedupe_ttl():
    from blockchain import async_client as ac

    ac._alert_last_fire.clear()
    key = "eth_call:warning"
    assert ac._alert_should_fire(key) is True
    # Second call within TTL must be suppressed.
    assert ac._alert_should_fire(key) is False
    # Clear and confirm it re-fires.
    ac._alert_last_fire.clear()
    assert ac._alert_should_fire(key) is True


@pytest.mark.asyncio
async def test_generic_rpc_error_is_warning(monkeypatch):
    """eth_call revert => WARNING, not CRITICAL."""
    from blockchain import async_client as ac
    from skill.observability import alerts as alerts_mod

    ac._alert_last_fire.clear()
    seen: list[dict] = []

    async def _fake_alert(title, message, severity=None, tags=None):
        seen.append({"severity": severity, "message": message})
        return True

    monkeypatch.setattr(alerts_mod, "alert", _fake_alert)
    monkeypatch.setattr("blockchain.async_client._alert_should_fire", lambda *a, **kw: True)
    await ac._maybe_alert_rpc_failure("eth_call", "execution reverted: ERC20 zero balance")
    assert seen, "alert should be sent"
    assert seen[-1]["severity"] == alerts_mod.AlertSeverity.WARNING


@pytest.mark.asyncio
async def test_connection_refused_is_critical(monkeypatch):
    from blockchain import async_client as ac
    from skill.observability import alerts as alerts_mod

    ac._alert_last_fire.clear()
    seen: list[dict] = []

    async def _fake_alert(title, message, severity=None, tags=None):
        seen.append({"severity": severity})
        return True

    monkeypatch.setattr(alerts_mod, "alert", _fake_alert)
    monkeypatch.setattr("blockchain.async_client._alert_should_fire", lambda *a, **kw: True)
    await ac._maybe_alert_rpc_failure("eth_call", "connection refused")
    assert seen[-1]["severity"] == alerts_mod.AlertSeverity.CRITICAL
