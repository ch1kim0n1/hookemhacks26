"""Admin-only endpoints must require a valid token.

These tests are the canonical check that ``/api/audit`` and ``/metrics``
cannot be scraped anonymously in a production configuration.
"""

from __future__ import annotations

import os
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

import skill.api as api_mod
from skill.config.settings import Settings


@pytest.fixture
def strict_settings(monkeypatch):
    """Force admin + metrics auth ON, regardless of import-time env."""
    strict = replace(
        api_mod.settings,
        require_admin_token=True,
        require_metrics_token=True,
    )
    monkeypatch.setattr(api_mod, "settings", strict)
    yield strict


@pytest.fixture
def client(strict_settings, monkeypatch):
    monkeypatch.setenv("ADMIN_API_TOKEN", "test-admin-token")
    monkeypatch.setenv("METRICS_BEARER_TOKEN", "test-metrics-token")
    return TestClient(api_mod.app)


def test_audit_without_token_is_401(client):
    r = client.get("/api/audit")
    assert r.status_code == 401


def test_audit_with_wrong_token_is_401(client):
    r = client.get("/api/audit", headers={"X-Admin-Token": "nope"})
    assert r.status_code == 401


def test_audit_with_correct_token_is_200(client):
    r = client.get("/api/audit", headers={"X-Admin-Token": "test-admin-token"})
    assert r.status_code == 200
    assert "logs" in r.json()


def test_metrics_without_token_is_401(client):
    r = client.get("/metrics")
    assert r.status_code == 401


def test_metrics_with_bearer_is_200(client):
    r = client.get(
        "/metrics",
        headers={"Authorization": "Bearer test-metrics-token"},
    )
    assert r.status_code == 200
    assert r.text.startswith("#")


def test_metrics_falls_back_to_admin_token(strict_settings, monkeypatch):
    """If METRICS_BEARER_TOKEN is unset, ADMIN_API_TOKEN still unlocks /metrics."""
    monkeypatch.delenv("METRICS_BEARER_TOKEN", raising=False)
    monkeypatch.setenv("ADMIN_API_TOKEN", "only-admin")
    with TestClient(api_mod.app) as c:
        r = c.get("/metrics", headers={"Authorization": "Bearer only-admin"})
        assert r.status_code == 200


def test_admin_auth_fails_closed_when_unconfigured(strict_settings, monkeypatch):
    """If REQUIRE_ADMIN_TOKEN is on but no ADMIN_API_TOKEN is set we MUST
    reject — never silently allow an unprotected audit endpoint."""
    monkeypatch.delenv("ADMIN_API_TOKEN", raising=False)
    monkeypatch.delenv("METRICS_BEARER_TOKEN", raising=False)
    with TestClient(api_mod.app) as c:
        r = c.get("/api/audit", headers={"X-Admin-Token": "anything"})
        assert r.status_code == 503


def test_admin_auth_disabled_allows_through():
    """If REQUIRE_ADMIN_TOKEN=false the endpoint is reachable (explicit opt-out)."""
    relaxed = replace(api_mod.settings, require_admin_token=False)
    import unittest.mock as _m
    with _m.patch.object(api_mod, "settings", relaxed), TestClient(api_mod.app) as c:
        r = c.get("/api/audit")
        assert r.status_code == 200


def test_ws_testclient_bypass_requires_pytest_env():
    """The ``testclient`` hostname bypass must be gated by PYTEST_CURRENT_TEST.

    We verify the helper directly because Starlette's TestClient always
    presents as ``testclient``.
    """
    import asyncio

    class _Sock:
        host = "testclient"

    class _WS:
        client = _Sock()
        query_params: dict[str, str] = {}

        def __init__(self):
            self.query_params = {}

    saved = os.environ.pop("PYTEST_CURRENT_TEST", None)
    try:
        assert not asyncio.run(api_mod._websocket_auth_ok(_WS(), token=None))
    finally:
        if saved is not None:
            os.environ["PYTEST_CURRENT_TEST"] = saved
