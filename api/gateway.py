"""Unified API gateway — extends `skill.api` with v1 routes."""

from __future__ import annotations

from skill.api import app

__all__ = ["app"]


@app.get("/api/v1/health")
async def health_v1():
    return {"status": "ok", "service": "clawguard-gateway"}


@app.get("/api/v1/quorum/status")
async def quorum_status():
    return {"k": 2, "n": 3, "accepted": 0, "note": "wire ConsensusVoting when deployed"}


@app.get("/api/v1/blocked-feed")
async def blocked_feed(limit: int = 50):
    from skill import db

    return db.get_recent_detections(limit)


@app.get("/api/v1/threat-map")
async def threat_map():
    return {"nodes": [], "edges": [], "note": "dashboard graph placeholder"}
