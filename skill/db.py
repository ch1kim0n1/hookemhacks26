"""SQLite store for local threat cache and detection logs."""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import time
from pathlib import Path

from skill.db_path import DB_PATH

logger = logging.getLogger(__name__)


def _needs_baseline_stamp() -> bool:
    """True if schema exists but Alembic has not recorded a revision (legacy or partial)."""
    if not DB_PATH.exists():
        return False
    conn = sqlite3.connect(str(DB_PATH))
    try:
        has_vtable = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='alembic_version'"
        ).fetchone()
        version_num: str | None = None
        if has_vtable:
            row = conn.execute("SELECT version_num FROM alembic_version").fetchone()
            version_num = row[0] if row else None
        if version_num:
            return False
        has_threat = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='threat_cache'"
        ).fetchone()
        return has_threat is not None
    finally:
        conn.close()


def run_migrations() -> None:
    """Apply Alembic migrations up to head."""
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    cfg = Config()
    migrations_dir = Path(__file__).resolve().parent / "migrations"
    cfg.set_main_option("script_location", str(migrations_dir))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{DB_PATH}")
    if _needs_baseline_stamp():
        command.stamp(cfg, "head")
        logger.info("Baseline Alembic stamp applied (pre-migration DB: %s)", DB_PATH)
        return
    command.upgrade(cfg, "head")
    logger.info("Database migrations completed (DB: %s)", DB_PATH)


def init_db() -> None:
    """Initialize schema via Alembic (backward-compatible name)."""
    run_migrations()


def sqlite_quick_check() -> tuple[bool, str]:
    """Run ``PRAGMA quick_check`` — fast on-disk integrity probe."""
    if not DB_PATH.exists():
        return False, "database file missing"
    conn = get_conn()
    try:
        rows = conn.execute("PRAGMA quick_check").fetchall()
        if not rows:
            return False, "no quick_check result"
        messages = [str(r[0]) for r in rows]
        if len(messages) == 1 and messages[0].lower() == "ok":
            return True, "ok"
        return False, "; ".join(messages[:10])
    finally:
        conn.close()


def alembic_revision_pair() -> tuple[str | None, str | None]:
    """Return ``(head_revision, current_revision)`` from the migration scripts
    and the attached database.

    ``current_revision`` is ``None`` when the DB file is missing or has no
    Alembic version row yet.
    """
    from alembic.config import Config
    from alembic.runtime.migration import MigrationContext
    from alembic.script import ScriptDirectory
    from sqlalchemy import create_engine

    migrations_dir = Path(__file__).resolve().parent / "migrations"
    cfg = Config()
    cfg.set_main_option("script_location", str(migrations_dir))
    script = ScriptDirectory.from_config(cfg)
    try:
        head = script.get_current_head()
    except Exception:
        head = None

    if not DB_PATH.exists():
        return head, None

    eng = create_engine(f"sqlite:///{DB_PATH}")
    with eng.connect() as conn:
        ctx = MigrationContext.configure(conn)
        current = ctx.get_current_revision()
    return head, current


def get_conn() -> sqlite3.Connection:
    # NB: SQLite busy_timeout is ms; this is the window the writer will wait
    # for a competing transaction before returning SQLITE_BUSY. 5s is a sane
    # default for our workload (single-writer, small reads).
    conn = sqlite3.connect(str(DB_PATH), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def cache_threat(
    pattern_hash: str,
    category: str,
    sample_redacted: str,
    reporter: str = "",
    block_number: int = 0,
):
    conn = get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO threat_cache VALUES (?, ?, ?, ?, ?, ?)",
        (pattern_hash, category, sample_redacted, reporter, block_number, int(time.time())),
    )
    conn.commit()
    conn.close()


def check_threat_cache(pattern_hash: str) -> dict | None:
    """Match full 64-char SHA-256 hex, legacy 16-char prefix keys, or on-chain rows."""
    key = pattern_hash.lower().strip().removeprefix("0x")
    if not key:
        return None
    if len(key) > 64:
        key = key[:64]
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM threat_cache WHERE pattern_hash = ?", (key,)
        ).fetchone()
        if not row and len(key) == 64:
            row = conn.execute(
                "SELECT * FROM threat_cache WHERE pattern_hash = ?", (key[:16],)
            ).fetchone()
        if not row and len(key) == 16:
            row = conn.execute(
                "SELECT * FROM threat_cache WHERE length(pattern_hash) = 64 "
                "AND substr(pattern_hash, 1, 16) = ? LIMIT 1",
                (key,),
            ).fetchone()
        try:
            from skill.observability import metrics as prom

            if row:
                prom.threat_cache_hits.inc()
            else:
                prom.threat_cache_misses.inc()
            count_row = conn.execute("SELECT COUNT(*) FROM threat_cache").fetchone()
            if count_row:
                prom.threat_cache_size.set(int(count_row[0]))
        except Exception:
            pass
        return dict(row) if row else None
    finally:
        conn.close()


def redact_content_preview(preview: str, max_len: int = 100) -> str:
    """Redact common PII patterns from preview text for WebSocket streaming."""
    redacted = preview or ""
    redacted = re.sub(
        r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
        "[EMAIL]",
        redacted,
    )
    redacted = re.sub(
        r"\+?1?\s*\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}",
        "[PHONE]",
        redacted,
    )
    redacted = re.sub(r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b", "[IP]", redacted)
    return redacted[:max_len]


def record_scan_attestation(
    *,
    content_hash: str,
    proof: str,
    image_id: str,
    mock: bool,
) -> None:
    """Store a ZK scan attestation record. Best-effort — uses audit_log so we
    don't need a schema migration for a demo-critical path. The distinct
    action name lets the dashboard filter them out."""
    detail = f"image_id={image_id} mock={int(bool(mock))} proof_len={len(proof)}"
    try:
        audit_log(
            action="zk_scan_attestation",
            resource=f"content_hash:{content_hash}",
            detail=detail,
            result="success",
        )
    except Exception:
        pass


def audit_log(
    action: str,
    resource: str = "",
    user_id: str = "",
    detail: str = "",
    result: str = "success",
) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO audit_log (timestamp, action, resource, user_id, detail, result) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (int(time.time()), action, resource, user_id, detail, result),
    )
    conn.commit()
    conn.close()


def get_audit_logs(
    action: str | None = None,
    limit: int = 100,
    before_id: int | None = None,
) -> list[dict]:
    """Audit log rows newest-first. When ``before_id`` is provided, returns
    rows with id < before_id (cursor pagination)."""
    limit = max(1, min(int(limit), 500))
    conn = get_conn()
    try:
        if action and before_id is not None:
            rows = conn.execute(
                "SELECT * FROM audit_log WHERE action = ? AND id < ? "
                "ORDER BY id DESC LIMIT ?",
                (action, int(before_id), limit),
            ).fetchall()
        elif action:
            rows = conn.execute(
                "SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT ?",
                (action, limit),
            ).fetchall()
        elif before_id is not None:
            rows = conn.execute(
                "SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?",
                (int(before_id), limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


def log_detection(
    tool_name: str,
    modality: str,
    verdict: str,
    confidence: float,
    reasons: list[str],
    content_hash: str,
    content_preview: str,
    source_manifest: dict | None = None,
):
    conn = get_conn()
    conn.execute(
        "INSERT INTO detection_log (timestamp, tool_name, modality, verdict, confidence, "
        "reasons, content_hash, content_preview, source_manifest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            int(time.time()),
            tool_name,
            modality,
            verdict,
            confidence,
            json.dumps(reasons),
            content_hash,
            content_preview[:500],
            json.dumps(source_manifest) if source_manifest else None,
        ),
    )
    conn.commit()
    conn.close()


def get_max_detection_id() -> int:
    conn = get_conn()
    row = conn.execute("SELECT COALESCE(MAX(id), 0) FROM detection_log").fetchone()
    conn.close()
    return int(row[0]) if row else 0


def get_detections_after_id(after_id: int, limit: int = 20) -> list[dict]:
    """Rows with id > after_id, oldest first (for WebSocket streaming)."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM detection_log WHERE id > ? ORDER BY id ASC LIMIT ?",
        (after_id, limit),
    ).fetchall()
    conn.close()
    results = []
    for row in rows:
        d = dict(row)
        d["reasons"] = json.loads(d["reasons"]) if d["reasons"] else []
        d["source_manifest"] = json.loads(d["source_manifest"]) if d["source_manifest"] else None
        results.append(d)
    return results


def get_recent_detections(
    limit: int = 50, before_id: int | None = None
) -> list[dict]:
    """Recent detections, newest-first. ``before_id`` enables cursor pagination."""
    limit = max(1, min(int(limit), 500))
    conn = get_conn()
    if before_id is not None:
        rows = conn.execute(
            "SELECT * FROM detection_log WHERE id < ? ORDER BY id DESC LIMIT ?",
            (int(before_id), limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM detection_log ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    conn.close()
    results = []
    for row in rows:
        d = dict(row)
        d["reasons"] = json.loads(d["reasons"]) if d["reasons"] else []
        d["source_manifest"] = json.loads(d["source_manifest"]) if d["source_manifest"] else None
        results.append(d)
    return results


def get_stats() -> dict:
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM detection_log").fetchone()[0]
    by_verdict = dict(
        conn.execute("SELECT verdict, COUNT(*) FROM detection_log GROUP BY verdict").fetchall()
    )
    by_modality = dict(
        conn.execute("SELECT modality, COUNT(*) FROM detection_log GROUP BY modality").fetchall()
    )
    # Hourly counts for last 24h
    cutoff = int(time.time()) - 86400
    hourly = conn.execute(
        "SELECT (timestamp / 3600) * 3600 as hour, COUNT(*) "
        "FROM detection_log WHERE timestamp > ? AND verdict != 'pass' "
        "GROUP BY hour ORDER BY hour",
        (cutoff,),
    ).fetchall()
    conn.close()
    return {
        "total_scans": total,
        "by_verdict": by_verdict,
        "by_modality": by_modality,
        "hourly_blocks": [{"hour": r[0], "count": r[1]} for r in hourly],
        "cached_threats": get_cached_threat_count(),
    }


def get_cached_threat_count() -> int:
    conn = get_conn()
    count = conn.execute("SELECT COUNT(*) FROM threat_cache").fetchone()[0]
    conn.close()
    return count


def get_all_cached_threats(
    limit: int = 100, before_cached_at: int | None = None
) -> list[dict]:
    """Cached threats newest-first. Cursor is ``cached_at`` (unix seconds)."""
    limit = max(1, min(int(limit), 500))
    conn = get_conn()
    if before_cached_at is not None:
        rows = conn.execute(
            "SELECT * FROM threat_cache WHERE cached_at < ? "
            "ORDER BY cached_at DESC LIMIT ?",
            (int(before_cached_at), limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM threat_cache ORDER BY cached_at DESC LIMIT ?", (limit,)
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
