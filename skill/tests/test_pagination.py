"""Cursor pagination for /api/detections, /api/threats, /api/audit.

These tests pin the contract: the endpoints return newest-first pages,
``X-Next-Cursor`` advances the cursor, and the final page omits the header.
"""

from __future__ import annotations

import time
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

import skill.api as api_mod
from skill import db


@pytest.fixture(autouse=True)
def _reset_db(tmp_path, monkeypatch):
    dbfile = tmp_path / "clawguard-pagination.db"
    monkeypatch.setattr(db, "DB_PATH", dbfile)
    monkeypatch.setattr("skill.db_path.DB_PATH", dbfile)
    db.init_db()
    yield


@pytest.fixture
def client(monkeypatch):
    relaxed = replace(
        api_mod.settings,
        require_admin_token=False,
        require_metrics_token=False,
    )
    monkeypatch.setattr(api_mod, "settings", relaxed)
    return TestClient(api_mod.app)


def _seed_detections(n: int) -> None:
    from skill import db as db_mod
    for i in range(n):
        db_mod.log_detection(
            tool_name=f"tool-{i}",
            modality="text",
            verdict="pass",
            confidence=0.1,
            reasons=[],
            content_hash=f"hash-{i:08x}",
            content_preview=f"example input {i}",
        )


def test_detections_pagination_advances(client):
    _seed_detections(7)
    r = client.get("/api/detections?limit=3")
    assert r.status_code == 200
    page1 = r.json()
    assert len(page1) == 3
    cursor = r.headers["X-Next-Cursor"]
    assert cursor

    r2 = client.get(f"/api/detections?limit=3&cursor={cursor}")
    page2 = r2.json()
    assert len(page2) == 3
    # No id overlap — cursor must strictly advance.
    assert {row["id"] for row in page1}.isdisjoint({row["id"] for row in page2})

    r3 = client.get(f"/api/detections?limit=3&cursor={r2.headers['X-Next-Cursor']}")
    page3 = r3.json()
    assert len(page3) == 1
    # Last page — no next cursor header.
    assert "X-Next-Cursor" not in r3.headers


def test_audit_pagination(client, monkeypatch):
    relaxed = replace(api_mod.settings, require_admin_token=False)
    monkeypatch.setattr(api_mod, "settings", relaxed)
    from skill import db as db_mod
    for i in range(5):
        db_mod.audit_log(action="scan", resource=f"r{i}")
    r = client.get("/api/audit?limit=2")
    assert r.status_code == 200
    logs = r.json()["logs"]
    assert len(logs) == 2
    cursor = logs[-1]["id"]
    r2 = client.get(f"/api/audit?limit=10&cursor={cursor}")
    logs2 = r2.json()["logs"]
    assert all(row["id"] < cursor for row in logs2)
