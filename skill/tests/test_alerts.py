"""Alert dispatcher."""

from unittest.mock import AsyncMock, patch

import pytest

from skill.observability.alerts import (
    AlertDispatcher,
    AlertSeverity,
    alert,
    init_alerts,
)


@pytest.mark.asyncio
async def test_alert_dispatcher_sends_to_slack():
    dispatcher = AlertDispatcher("https://hooks.slack.com/test")
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_resp = mock_post.return_value
        mock_resp.raise_for_status = lambda: None
        success = await dispatcher.send(
            "Test Alert",
            "Test message",
            severity=AlertSeverity.CRITICAL,
        )
    assert success is True
    mock_post.assert_called_once()


@pytest.mark.asyncio
async def test_alert_dispatcher_handles_failure():
    dispatcher = AlertDispatcher("https://hooks.slack.com/test")
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = Exception("Connection refused")
        success = await dispatcher.send("Test", "Message")
    assert success is False


@pytest.mark.asyncio
async def test_global_alert_function():
    init_alerts("https://hooks.slack.com/test")
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_resp = mock_post.return_value
        mock_resp.raise_for_status = lambda: None
        success = await alert("Test", "Message", AlertSeverity.WARNING)
    assert success is True
