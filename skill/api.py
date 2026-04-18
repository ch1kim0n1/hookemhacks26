"""FastAPI server exposing ClawGuard endpoints for the dashboard."""

import asyncio
import logging
import os
import time
from collections import defaultdict

from fastapi import (
    APIRouter,
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import db
from .handler import get_chain_client, scan_only
from .skill_audit import audit_skill_manifest

try:
    from learning.metrics import snapshot as learning_snapshot
except ImportError:

    def learning_snapshot():  # type: ignore[misc]
        return {}

logger = logging.getLogger("clawguard.api")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="ClawGuard API", version="0.1.0")

_cors_raw = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5175,http://127.0.0.1:5175",
)
_allow_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]
if not _allow_origins:
    _allow_origins = ["http://localhost:5175"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

_RATE_WINDOW_SEC = 60.0
_RATE_MAX = int(os.getenv("API_RATE_LIMIT_PER_MIN", "100"))
_MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
_API_TIMEOUT_SEC = float(os.getenv("API_HANDLER_TIMEOUT_SEC", "30.0"))


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window-ish rate limiter per client IP."""

    def __init__(self, app, *, max_per_window: int, window_sec: float) -> None:
        super().__init__(app)
        self.max_per_window = max_per_window
        self.window_sec = window_sec
        self._hits: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        if request.scope["type"] != "http":
            return await call_next(request)
        path = request.url.path
        if path in ("/api/health", "/docs", "/openapi.json", "/redoc"):
            return await call_next(request)
        client = request.client.host if request.client else "unknown"
        now = time.monotonic()
        window_start = now - self.window_sec
        q = self._hits[client]
        q[:] = [t for t in q if t > window_start]
        if len(q) >= self.max_per_window:
            return JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
        q.append(now)
        return await call_next(request)


app.add_middleware(
    RateLimitMiddleware, max_per_window=_RATE_MAX, window_sec=_RATE_WINDOW_SEC
)


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.scope["type"] != "http":
            return await call_next(request)
        start = time.perf_counter()
        try:
            response = await asyncio.wait_for(
                call_next(request), timeout=_API_TIMEOUT_SEC
            )
        except TimeoutError:
            logger.exception("request_timeout path=%s", request.url.path)
            return JSONResponse({"detail": "request timeout"}, status_code=504)
        except Exception:
            logger.exception("request_failed path=%s", request.url.path)
            raise
        ms = (time.perf_counter() - start) * 1000
        logger.info(
            "%s %s -> %s %.1fms",
            request.method,
            request.url.path,
            response.status_code,
            ms,
        )
        return response


app.add_middleware(RequestLogMiddleware)


class ScanRequest(BaseModel):
    content: str = Field(..., max_length=512_000)
    content_type: str | None = None
    tool_name: str = "manual"


@app.post("/api/scan")
async def scan_text(req: ScanRequest):
    """Scan text content for injection attempts."""
    result = scan_only(req.content, content_type=req.content_type, tool_name=req.tool_name)
    return result


@app.post("/api/scan/file")
async def scan_file(file: UploadFile = File(...), tool_name: str = Form("manual")):
    """Scan an uploaded file for injection attempts."""
    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"file too large (max {_MAX_UPLOAD_BYTES} bytes)",
        )
    result = scan_only(
        content,
        content_type=file.content_type,
        filename=file.filename,
        tool_name=tool_name,
    )
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
    result = scan_only(req.content, content_type=req.content_type, tool_name="replay")
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


class SkillAuditRequest(BaseModel):
    manifest: str


@app.post("/api/scan/skill")
async def scan_skill_manifest_endpoint(req: SkillAuditRequest):
    """Assess an OpenClaw SKILL.md body for common malware / over-privileged patterns."""
    if not req.manifest or not req.manifest.strip():
        raise HTTPException(status_code=400, detail="manifest required")
    return audit_skill_manifest(req.manifest)


# --- Dashboard-oriented aliases (also exposed under /api/v1) ---

SCENARIO_INFO = {
    "email-injection": {
        "id": "email-injection",
        "name": "Email body override",
        "blocked_sample": "Instruction override inside HTML / MIME parts",
    },
    "pdf-hidden": {
        "id": "pdf-hidden",
        "name": "PDF invisible layer",
        "blocked_sample": "Hidden text layers and annotations",
    },
    "web-fetch": {
        "id": "web-fetch",
        "name": "Web content injection",
        "blocked_sample": "Fetched page contains delimiter abuse or exfil patterns",
    },
}


@app.get("/api/attacks")
async def attacks_feed(limit: int = 50):
    """Non-block verdicts and blocks — alias for dashboard 'blocked attacks' feed."""
    rows = db.get_recent_detections(limit)
    return {"attacks": [r for r in rows if r.get("verdict") != "pass"]}


@app.get("/api/scenario/{scenario_id}")
async def scenario_detail(scenario_id: str):
    meta = SCENARIO_INFO.get(scenario_id)
    if not meta:
        raise HTTPException(status_code=404, detail="unknown scenario")
    stats = db.get_stats()
    return {
        **meta,
        "global_stats": stats,
    }


@app.get("/api/network")
async def network_view():
    peer_urls = [
        p.strip() for p in os.getenv("CLAWGUARD_PEER_URLS", "").split(",") if p.strip()
    ]
    client = get_chain_client()
    events = client.poll_recent(15) if client.available else []
    return {
        "nodes": [
            {"id": "agent-local", "role": "openclaw-agent", "status": "ok"},
            {"id": "clawguard-api", "role": "middleware", "status": "ok"},
        ],
        "peer_urls_configured": peer_urls,
        "on_chain_events": events,
    }


@app.get("/api/learning")
async def learning_metrics():
    snap = learning_snapshot()
    return {
        "mode": "inline",
        "note": "Red/blue round metrics tracked in-process for this API build.",
        "stats": db.get_stats(),
        "variations_generated": snap.get("variations_generated", 0),
        "rules_extracted": snap.get("rules_extracted", 0),
        "rounds_completed": snap.get("rounds_completed", 0),
        "accuracy_trend": snap.get("accuracy_trend", []),
        "model_updates": snap.get("model_updates", []),
        "last_publish_ok": snap.get("last_publish_ok"),
        "last_update": snap.get("last_update_ts"),
    }


async def _push_updates_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    last_id = db.get_max_detection_id()
    try:
        while True:
            new_rows = db.get_detections_after_id(last_id, limit=50)
            for row in new_rows:
                last_id = max(last_id, int(row["id"]))
                if row.get("verdict") and row["verdict"] != "pass":
                    await websocket.send_json({"type": "detection", "detection": row})
            await websocket.send_json(
                {
                    "type": "stats",
                    "stats": db.get_stats(),
                    "cached_threats": db.get_cached_threat_count(),
                }
            )
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        return


@app.websocket("/ws/updates")
async def updates_stream(websocket: WebSocket):
    """Live stats + non-pass detections as they are logged."""
    await _push_updates_websocket(websocket)


@app.websocket("/updates")
async def updates_stream_short_path(websocket: WebSocket):
    """Alias for clients expecting `/updates` at app root (proxied)."""
    await _push_updates_websocket(websocket)


v1 = APIRouter(prefix="/api/v1")


@v1.post("/scan", response_model=None)
async def v1_scan(req: ScanRequest):
    return await scan_text(req)


@v1.get("/attacks")
async def v1_attacks(limit: int = 50):
    return await attacks_feed(limit)


@v1.get("/scenario/{scenario_id}")
async def v1_scenario(scenario_id: str):
    return await scenario_detail(scenario_id)


@v1.get("/network")
async def v1_network():
    return await network_view()


@v1.get("/learning")
async def v1_learning():
    return await learning_metrics()


@v1.websocket("/updates")
async def v1_updates(websocket: WebSocket):
    await _push_updates_websocket(websocket)


app.include_router(v1)
