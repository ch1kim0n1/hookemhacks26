"""Liveness vs readiness endpoints."""

from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

import skill.api as api_mod


def test_health_includes_version():
    r = TestClient(api_mod.app).get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body
    assert body["version"]


def test_ready_reports_database_ok():
    r = TestClient(api_mod.app).get("/api/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["ready"] is True
    assert body["database"]["integrity_ok"] is True
    assert body["migrations"]["at_head"] is True


def test_security_headers_on_health():
    r = TestClient(api_mod.app).get("/api/health")
    h = {k.lower(): v for k, v in r.headers.items()}
    assert h.get("x-content-type-options") == "nosniff"
    assert h.get("x-frame-options") == "DENY"
    assert h.get("referrer-policy") == "strict-origin-when-cross-origin"


def test_hsts_only_when_enabled(monkeypatch):
    monkeypatch.setattr(
        api_mod,
        "settings",
        replace(api_mod.settings, enable_hsts=True, hsts_max_age_sec=3600),
    )
    r = TestClient(api_mod.app).get("/api/health")
    h = {k.lower(): v for k, v in r.headers.items()}
    assert "max-age=3600" in h.get("strict-transport-security", "")


def test_hsts_off_by_default():
    r = TestClient(api_mod.app).get("/api/health")
    assert "strict-transport-security" not in {k.lower() for k in r.headers.keys()}
