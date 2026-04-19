"""FastAPI server exposing ClawGuard endpoints for the dashboard."""

import asyncio
import hmac
import logging
import os
import secrets as _stdlib_secrets
import signal
import time
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import (
    APIRouter,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import make_asgi_app
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse

from skill.config.secrets import get_secret, init_secrets
from skill.config.settings import settings
from skill.observability.logging import setup_logging

from . import db
from .chain import ChainClient
from .handler import get_chain_client, scan_only
from .skill_audit import audit_skill_manifest

try:
    from learning.metrics import snapshot as learning_snapshot
except ImportError:

    def learning_snapshot():  # type: ignore[misc]
        return {}


setup_logging()
logger = logging.getLogger("clawguard.api")


def _package_version() -> str:
    try:
        from importlib.metadata import version

        return version("clawguard")
    except Exception:
        return "0.1.0"


_shutdown_event = asyncio.Event()
_SKILL_MANIFEST_WINDOW_SEC = 60.0
skill_manifest_rate_state: dict[str, list[float]] = defaultdict(list)


def _setup_signal_handlers() -> None:
    if (
        os.environ.get("PYTEST_CURRENT_TEST")
        or os.environ.get("CLAWGUARD_DISABLE_SIGNAL_HANDLERS")
        or os.environ.get("VERCEL")
    ):
        return

    def _handler(signum: int, _frame: object) -> None:
        logger.info("Received signal %s, initiating shutdown", signum)
        _shutdown_event.set()

    try:
        signal.signal(signal.SIGTERM, _handler)
        signal.signal(signal.SIGINT, _handler)
    except ValueError:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    _setup_signal_handlers()
    init_secrets("env")
    db.init_db()
    from skill.observability.alerts import init_alerts
    from skill.observability.tracing import init_tracing

    init_tracing(app)
    slack = get_secret("SLACK_WEBHOOK_URL", default="")
    if slack:
        init_alerts(slack)
        logger.info("Slack alerting configured")
    logger.info("Secrets manager initialized; database migrations applied")
    yield
    logger.info("ClawGuard API shutting down")
    await asyncio.sleep(0.2)


_docs = "/docs" if settings.expose_openapi else None
_openapi = "/openapi.json" if settings.expose_openapi else None
_redoc = "/redoc" if settings.expose_openapi else None

app = FastAPI(
    title="ClawGuard API",
    version=_package_version(),
    lifespan=lifespan,
    docs_url=_docs,
    openapi_url=_openapi,
    redoc_url=_redoc,
)

_cors_raw = get_secret(
    "CORS_ORIGINS",
    default="http://localhost:5175,http://127.0.0.1:5175",
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
_MAX_UPLOAD_BYTES = settings.max_upload_bytes
_API_TIMEOUT_SEC = settings.api_handler_timeout_sec
# Module-level hit map so tests can ``clear()`` without reaching into middleware
# instances (Starlette stacks those internally).
_rate_limit_hits: dict[str, list[float]] = defaultdict(list)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window-ish rate limiter per client IP."""

    def __init__(self, app, *, window_sec: float) -> None:
        super().__init__(app)
        self.window_sec = window_sec

    async def dispatch(self, request: Request, call_next):
        if request.scope["type"] != "http":
            return await call_next(request)
        path = request.url.path
        if path in (
            "/api/health",
            "/api/ready",
            "/docs",
            "/openapi.json",
            "/redoc",
        ):
            return await call_next(request)
        client = _client_ip(request)
        now = time.monotonic()
        window_start = now - self.window_sec
        q = _rate_limit_hits[client]
        q[:] = [t for t in q if t > window_start]
        # Limits are read from settings on each request so tests can monkeypatch.
        cap = (
            settings.metrics_rate_limit_per_min
            if path.startswith("/metrics")
            else settings.api_rate_limit_per_min
        )
        if len(q) >= cap:
            return JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
        q.append(now)
        return await call_next(request)


app.add_middleware(RateLimitMiddleware, window_sec=_RATE_WINDOW_SEC)


def _require_admin_token(
    request: Request,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> None:
    """Reject unless the admin bearer is supplied (or auth is disabled)."""
    if not settings.require_admin_token:
        return
    expected = get_secret("ADMIN_API_TOKEN", default="")
    if not expected:
        # Fail-closed: no token configured means admin endpoints are locked.
        raise HTTPException(
            status_code=503,
            detail="admin endpoint not configured (set ADMIN_API_TOKEN)",
        )
    supplied = x_admin_token or ""
    if not _stdlib_secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="admin token required")


def _metrics_auth_ok(request: Request) -> bool:
    if not settings.require_metrics_token:
        return True
    expected = get_secret("METRICS_BEARER_TOKEN", default="")
    if not expected:
        # Fall back to ADMIN_API_TOKEN if METRICS_BEARER_TOKEN is unset
        expected = get_secret("ADMIN_API_TOKEN", default="")
    if not expected:
        return False
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        token = header.split(" ", 1)[1].strip()
    else:
        token = request.headers.get("x-metrics-token", "")
    if not token:
        return False
    return _stdlib_secrets.compare_digest(token, expected)


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.scope["type"] != "http":
            return await call_next(request)
        req_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        request.state.request_id = req_id
        start = time.perf_counter()
        try:
            response = await asyncio.wait_for(call_next(request), timeout=_API_TIMEOUT_SEC)
        except TimeoutError:
            logger.exception(
                "request_timeout",
                extra={"request_id": req_id, "path": request.url.path},
            )
            return JSONResponse(
                {"detail": "request timeout", "request_id": req_id},
                status_code=504,
                headers={"X-Request-ID": req_id},
            )
        except Exception:
            logger.exception(
                "request_failed",
                extra={"request_id": req_id, "path": request.url.path},
            )
            raise
        ms = (time.perf_counter() - start) * 1000
        response.headers["X-Request-ID"] = req_id
        logger.info(
            "request",
            extra={
                "request_id": req_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "latency_ms": round(ms, 1),
            },
        )
        return response


class CSPMiddleware(BaseHTTPMiddleware):
    """Security headers on HTTP responses (CSP + baseline OWASP helpers)."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "font-src 'self'; "
            "connect-src 'self' ws: wss:; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if settings.enable_hsts:
            response.headers["Strict-Transport-Security"] = (
                f"max-age={settings.hsts_max_age_sec}; includeSubDomains"
            )
        return response


app.add_middleware(RequestLogMiddleware)
app.add_middleware(CSPMiddleware)


def _skill_manifest_rate_allow(request: Request) -> bool:
    max_r = settings.skill_audit_rate_limit_per_min
    ip = _client_ip(request)
    now = time.monotonic()
    cutoff = now - _SKILL_MANIFEST_WINDOW_SEC
    q = skill_manifest_rate_state[ip]
    q[:] = [t for t in q if t > cutoff]
    if len(q) >= max_r:
        return False
    q.append(now)
    return True


def _validate_bearer_token(token: str) -> bool:
    expected = get_secret("WS_BEARER_TOKEN", default="")
    if not expected:
        return False
    return hmac.compare_digest(
        token.encode("utf-8"),
        expected.encode("utf-8"),
    )


async def _websocket_auth_ok(websocket: WebSocket, token: str | None) -> bool:
    host = websocket.client.host if websocket.client else ""
    # Real loopback always allowed; the fake Starlette "testclient" host is
    # ONLY allowed when we are actually inside a pytest run (never in prod).
    if host in ("127.0.0.1", "::1", "localhost"):
        return True
    if host == "testclient" and os.environ.get("PYTEST_CURRENT_TEST"):
        return True
    if not token:
        return False
    return _validate_bearer_token(token)


def _observe_scan_metrics(result: dict, start: float) -> None:
    inner = result.get("verdict")
    if isinstance(inner, dict):
        verdict_label = inner.get("verdict", "unknown")
    else:
        verdict_label = result.get("action", "unknown")
    modality = str(result.get("extraction", {}).get("modality", "unknown"))
    try:
        from skill.observability import metrics as prom

        prom.detections_total.labels(
            verdict=str(verdict_label), modality=modality
        ).inc()
        prom.detection_latency.observe(time.perf_counter() - start)
    except Exception:
        pass


class ScanRequest(BaseModel):
    content: str = Field(..., max_length=512_000)
    content_type: str | None = None
    tool_name: str = "manual"


@app.post("/api/scan")
async def scan_text(req: ScanRequest):
    """Scan text content for injection attempts."""
    from skill.observability.tracing import get_tracer

    tracer = get_tracer("clawguard.api")
    start = time.perf_counter()
    with tracer.start_as_current_span("scan_text") as span:
        span.set_attribute("content_length", len(req.content))
        result = scan_only(
            req.content, content_type=req.content_type, tool_name=req.tool_name
        )
        inner = result.get("verdict")
        if isinstance(inner, dict):
            span.set_attribute("verdict", str(inner.get("verdict", "")))
        _observe_scan_metrics(result, start)
    return result


@app.post("/api/scan/file")
async def scan_file(file: UploadFile = File(...), tool_name: str = Form("manual")):
    """Scan an uploaded file for injection attempts."""
    from skill.observability.tracing import get_tracer

    tracer = get_tracer("clawguard.api")
    start = time.perf_counter()
    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"file too large (max {_MAX_UPLOAD_BYTES} bytes)",
        )
    with tracer.start_as_current_span("scan_file") as span:
        span.set_attribute("filename", file.filename or "")
        result = scan_only(
            content,
            content_type=file.content_type,
            filename=file.filename,
            tool_name=tool_name,
        )
        _observe_scan_metrics(result, start)
    return result


@app.get("/api/detections")
async def get_detections(limit: int = 50, cursor: int | None = None):
    """Get recent detection logs. Cursor pagination via ``?cursor=<id>``;
    the next cursor is returned as the ``X-Next-Cursor`` response header."""
    rows = db.get_recent_detections(limit, before_id=cursor)
    # Only emit a cursor when we actually filled the page — a short page is
    # the terminal page and clients should stop, not loop.
    next_cursor = rows[-1]["id"] if rows and len(rows) >= limit else None
    headers = {"X-Next-Cursor": str(next_cursor)} if next_cursor else {}
    return JSONResponse(rows, headers=headers)


@app.get("/api/stats")
async def get_stats():
    """Get detection statistics."""
    return db.get_stats()


@app.get("/api/threats")
async def get_threats(limit: int = 100, cursor: int | None = None):
    """Get cached on-chain threats. Cursor is ``cached_at``; next cursor is
    returned via the ``X-Next-Cursor`` header."""
    rows = db.get_all_cached_threats(limit, before_cached_at=cursor)
    next_cursor = rows[-1]["cached_at"] if rows and len(rows) >= limit else None
    headers = {"X-Next-Cursor": str(next_cursor)} if next_cursor else {}
    return JSONResponse(rows, headers=headers)


@app.post("/api/replay")
async def replay_attack(req: ScanRequest):
    """Replay an attack for demo purposes — same as scan but clearly labeled."""
    from skill.observability.tracing import get_tracer

    start = time.perf_counter()
    with get_tracer("clawguard.api").start_as_current_span("replay") as span:
        span.set_attribute("content_length", len(req.content))
        result = scan_only(
            req.content, content_type=req.content_type, tool_name="replay"
        )
        _observe_scan_metrics(result, start)
    return result


@app.get("/api/chain/poll")
async def poll_chain():
    """Manually trigger a chain poll."""
    client = get_chain_client()
    attacks = client.poll_recent(20)
    return {"polled": len(attacks), "attacks": attacks}


@app.get("/api/health")
async def health():
    """Liveness: process is up. Does not start chain polling."""
    # Use a fresh ChainClient snapshot — never call get_chain_client() here
    # (that starts a background poll thread on first use).
    chain = ChainClient()
    try:
        threats = db.get_cached_threat_count()
    except Exception:
        threats = 0
    return {
        "status": "ok",
        "version": _package_version(),
        "chain_available": chain.available,
        "cached_threats": threats,
    }


@app.get("/api/ready")
async def ready():
    """Readiness: SQLite integrity + Alembic at head. Returns 503 until healthy."""

    def _probe() -> dict:
        integrity_ok, integrity_msg = db.sqlite_quick_check()
        head, current = db.alembic_revision_pair()
        migrations_ok = False if head is None else current == head
        at_head = bool(head and current == head)
        db_ok = integrity_ok and migrations_ok
        return {
            "ready": db_ok,
            "database": {"integrity_ok": integrity_ok, "detail": integrity_msg},
            "migrations": {
                "head": head,
                "current": current,
                "at_head": at_head,
            },
        }

    payload = await asyncio.to_thread(_probe)
    status = 200 if payload["ready"] else 503
    return JSONResponse(payload, status_code=status)


class SkillAuditRequest(BaseModel):
    manifest: str


async def _handle_skill_audit(req: SkillAuditRequest, request: Request):
    if not _skill_manifest_rate_allow(request):
        raise HTTPException(
            status_code=429,
            detail="rate limit exceeded for skill manifest audit",
        )
    if not req.manifest or not req.manifest.strip():
        raise HTTPException(status_code=400, detail="manifest required")
    return audit_skill_manifest(req.manifest)


@app.post("/api/scan/skill")
async def scan_skill_manifest_endpoint(req: SkillAuditRequest, request: Request):
    """Assess an OpenClaw SKILL.md body for common malware / over-privileged patterns."""
    return await _handle_skill_audit(req, request)


@app.post("/api/skill")
async def audit_skill_alias(req: SkillAuditRequest, request: Request):
    """Alias for manifest audit (rate-limited)."""
    return await _handle_skill_audit(req, request)


@app.get("/api/audit")
async def get_audit(
    request: Request,
    action: str | None = None,
    limit: int = 100,
    cursor: int | None = None,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
):
    """Audit log — requires ``X-Admin-Token`` (set ``ADMIN_API_TOKEN``)."""
    _require_admin_token(request, x_admin_token)
    limit = max(1, min(int(limit), 500))
    return {"logs": db.get_audit_logs(action, limit, before_id=cursor)}


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


async def _push_updates_websocket(
    websocket: WebSocket, token: str | None = None
) -> None:
    if not await _websocket_auth_ok(websocket, token):
        await websocket.close(code=1008, reason="authentication required")
        return
    await websocket.accept()
    last_id = db.get_max_detection_id()
    try:
        while True:
            new_rows = db.get_detections_after_id(last_id, limit=50)
            for row in new_rows:
                last_id = max(last_id, int(row["id"]))
                if row.get("verdict") and row["verdict"] != "pass":
                    det = dict(row)
                    det["content_preview"] = db.redact_content_preview(
                        det.get("content_preview") or ""
                    )
                    await websocket.send_json({"type": "detection", "detection": det})
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
async def updates_stream(
    websocket: WebSocket, token: str | None = Query(default=None)
):
    """Live stats + non-pass detections as they are logged."""
    await _push_updates_websocket(websocket, token)


@app.websocket("/updates")
async def updates_stream_short_path(
    websocket: WebSocket, token: str | None = Query(default=None)
):
    """Alias for clients expecting `/updates` at app root (proxied)."""
    await _push_updates_websocket(websocket, token)


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
async def v1_updates(
    websocket: WebSocket, token: str | None = Query(default=None)
):
    await _push_updates_websocket(websocket, token)


app.include_router(v1)


_prometheus_asgi = make_asgi_app()


@app.get("/metrics")
async def prometheus_metrics(request: Request):
    """Prometheus scrape endpoint — requires Bearer or ``X-Metrics-Token``."""
    if not _metrics_auth_ok(request):
        return PlainTextResponse("metrics auth required\n", status_code=401)
    # Hand off to the prometheus_client ASGI app for the actual payload.
    from starlette.responses import Response

    captured: dict[str, object] = {}

    async def _send(message):  # type: ignore[no-redef]
        if message["type"] == "http.response.start":
            captured["status"] = message["status"]
            captured["headers"] = message.get("headers", [])
        elif message["type"] == "http.response.body":
            body_chunks = captured.setdefault("body", bytearray())
            body_chunks.extend(message.get("body", b""))  # type: ignore[union-attr]

    async def _receive():  # type: ignore[no-redef]
        return {"type": "http.request", "body": b"", "more_body": False}

    await _prometheus_asgi(request.scope, _receive, _send)
    body_val = captured.get("body") or b""
    body = bytes(body_val) if isinstance(body_val, (bytes, bytearray)) else b""
    headers_val = captured.get("headers") or []
    headers = {
        h[0].decode() if isinstance(h[0], bytes) else h[0]: h[1].decode()
        if isinstance(h[1], bytes)
        else h[1]
        for h in headers_val
    }
    status = int(captured.get("status") or 200)
    return Response(content=body, status_code=status, headers=headers)
