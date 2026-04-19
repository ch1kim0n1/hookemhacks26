"""Slack (and future) alerting for critical events."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from enum import StrEnum

import httpx

from skill.config.secrets import get_secret

logger = logging.getLogger(__name__)

# TTL dedupe — don't spam identical alerts (key: "<title>|<severity>").
_DEDUPE_TTL_SEC = 300.0
_last_fire: dict[str, float] = {}


def _should_fire(key: str) -> bool:
    now = time.monotonic()
    last = _last_fire.get(key)
    if last is not None and now - last < _DEDUPE_TTL_SEC:
        return False
    _last_fire[key] = now
    return True


def reset_dedupe() -> None:
    """Clear the dedupe state — intended for tests only."""
    _last_fire.clear()


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
        *,
        dedupe: bool = True,
    ) -> bool:
        if dedupe and not _should_fire(f"{title}|{severity.value}"):
            logger.debug("Alert deduped: %s (%s)", title, severity.value)
            return False
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
    """Send alert from synchronous code.

    Works from both pure-sync contexts (e.g. a CLI / learning loop) and from
    inside threads created by an async framework. When a running loop is
    detected we dispatch to a short-lived worker thread so we never silently
    drop the alert.
    """

    def _run_in_thread() -> bool:
        result: dict[str, bool] = {"ok": False}

        def _target() -> None:
            try:
                result["ok"] = asyncio.run(alert(title, message, severity, tags))
            except Exception as exc:  # pragma: no cover - defensive
                logger.error("alert_sync worker failed: %s", exc)

        t = threading.Thread(target=_target, name="alert-sync-worker", daemon=True)
        t.start()
        t.join(timeout=15.0)
        if t.is_alive():
            logger.warning("alert_sync worker did not complete within timeout")
            return False
        return result["ok"]

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(alert(title, message, severity, tags))
    return _run_in_thread()
