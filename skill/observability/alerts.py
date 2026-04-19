"""Slack (and future) alerting for critical events."""

from __future__ import annotations

import asyncio
import logging
from enum import StrEnum

import httpx

from skill.config.secrets import get_secret

logger = logging.getLogger(__name__)


class AlertSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AlertDispatcher:
    def __init__(self, slack_webhook_url: str | None = None) -> None:
        self.slack_webhook = slack_webhook_url

    async def send(
        self,
        title: str,
        message: str,
        severity: AlertSeverity = AlertSeverity.WARNING,
        tags: dict[str, str] | None = None,
    ) -> bool:
        success = False
        if self.slack_webhook:
            ok = await self._send_slack(title, message, severity, tags)
            success = success or ok
        if not success and self.slack_webhook is None:
            logger.debug("No Slack webhook configured; alert not sent: %s", title)
        return success

    async def _send_slack(
        self,
        title: str,
        message: str,
        severity: AlertSeverity,
        tags: dict[str, str] | None,
    ) -> bool:
        color_map = {
            AlertSeverity.INFO: "#36a64f",
            AlertSeverity.WARNING: "#ff9900",
            AlertSeverity.CRITICAL: "#ff0000",
        }
        fields = [
            {"title": "Severity", "value": severity.value, "short": True},
            *[
                {"title": k, "value": v, "short": True}
                for k, v in (tags or {}).items()
            ],
        ]
        payload = {
            "attachments": [
                {
                    "color": color_map[severity],
                    "title": title,
                    "text": message,
                    "fields": fields,
                }
            ]
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(self.slack_webhook, json=payload)
                response.raise_for_status()
            logger.info("Alert sent to Slack: %s", title)
            return True
        except Exception as exc:
            logger.error("Failed to send Slack alert: %s", exc)
            return False


_dispatcher: AlertDispatcher | None = None


def init_alerts(slack_webhook_url: str | None = None) -> AlertDispatcher:
    global _dispatcher
    _dispatcher = AlertDispatcher(slack_webhook_url)
    return _dispatcher


def get_dispatcher() -> AlertDispatcher | None:
    return _dispatcher


async def alert(
    title: str,
    message: str,
    severity: AlertSeverity = AlertSeverity.WARNING,
    tags: dict[str, str] | None = None,
) -> bool:
    disp = _dispatcher
    if disp is None:
        url = get_secret("SLACK_WEBHOOK_URL", default="")
        if not url:
            logger.debug("Alert dispatcher unset and SLACK_WEBHOOK_URL empty: %s", title)
            return False
        disp = init_alerts(url)
    return await disp.send(title, message, severity, tags)


def alert_sync(
    title: str,
    message: str,
    severity: AlertSeverity = AlertSeverity.WARNING,
    tags: dict[str, str] | None = None,
) -> bool:
    """Send alert from synchronous code (e.g. learning loop)."""

    def _run() -> bool:
        return asyncio.run(alert(title, message, severity, tags))

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return _run()
    else:
        logger.debug("alert_sync skipped inside running loop: %s", title)
        return False
