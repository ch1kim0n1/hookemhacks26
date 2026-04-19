"""Async JSON-RPC client."""

from unittest.mock import AsyncMock, MagicMock, patch

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
