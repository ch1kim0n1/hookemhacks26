"""FastAPI server exposing ClawGuard endpoints for the dashboard."""

import json
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .handler import scan_only, get_chain_client
from . import db

app = FastAPI(title="ClawGuard API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # localhost only in practice
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScanRequest(BaseModel):
    content: str
    content_type: str | None = None
    tool_name: str = "manual"


@app.post("/api/scan")
async def scan_text(req: ScanRequest):
    """Scan text content for injection attempts."""
    result = scan_only(req.content, content_type=req.content_type,
                       tool_name=req.tool_name)
    return result


@app.post("/api/scan/file")
async def scan_file(file: UploadFile = File(...), tool_name: str = Form("manual")):
    """Scan an uploaded file for injection attempts."""
    content = await file.read()
    result = scan_only(content, content_type=file.content_type,
                       filename=file.filename, tool_name=tool_name)
    return result


@app.get("/api/detections")
async def get_detections(limit: int = 50):
    """Get recent detection logs."""
    return db.get_recent_detections(limit)


@app.get("/api/stats")
async def get_stats():
    """Get detection statistics."""
    return db.get_stats()


@app.get("/api/threats")
async def get_threats(limit: int = 100):
    """Get cached on-chain threats."""
    return db.get_all_cached_threats(limit)


@app.post("/api/replay")
async def replay_attack(req: ScanRequest):
    """Replay an attack for demo purposes — same as scan but clearly labeled."""
    result = scan_only(req.content, content_type=req.content_type,
                       tool_name="replay")
    return result


@app.get("/api/chain/poll")
async def poll_chain():
    """Manually trigger a chain poll."""
    client = get_chain_client()
    attacks = client.poll_recent(20)
    return {"polled": len(attacks), "attacks": attacks}


@app.get("/api/health")
async def health():
    chain = get_chain_client()
    return {
        "status": "ok",
        "chain_available": chain.available,
        "cached_threats": db.get_cached_threat_count(),
    }
