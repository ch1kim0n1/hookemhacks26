"""Rate limiting must key off the real client when behind a proxy."""

from __future__ import annotations

from dataclasses import replace

from fastapi.testclient import TestClient

import skill.api as api_mod


def test_rate_limit_buckets_by_x_forwarded_for(monkeypatch):
    monkeypatch.setattr(
        api_mod,
        "settings",
        replace(api_mod.settings, api_rate_limit_per_min=2),
    )
    c = TestClient(api_mod.app)
    hdr = {"X-Forwarded-For": "192.0.2.50"}
    assert c.get("/api/stats", headers=hdr).status_code == 200
    assert c.get("/api/stats", headers=hdr).status_code == 200
    assert c.get("/api/stats", headers=hdr).status_code == 429
    assert c.get("/api/stats", headers={"X-Forwarded-For": "192.0.2.51"}).status_code == 200
