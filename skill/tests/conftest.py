"""Shared fixtures for skill tests."""

import pytest

from skill import db


@pytest.fixture(scope="session", autouse=True)
def _init_skill_database() -> None:
    """Ensure SQLite schema exists for tests that use skill.db directly."""
    db.init_db()


@pytest.fixture(autouse=True)
def _reset_alert_dedupe():
    """Reset alert TTL-dedupe state between tests so test order doesn't
    silently suppress alerts in the next test."""
    from skill.observability import alerts

    alerts.reset_dedupe()
    yield
    alerts.reset_dedupe()


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    from skill import api as api_mod

    api_mod._rate_limit_hits.clear()
    yield
    api_mod._rate_limit_hits.clear()
