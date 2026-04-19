"""Typed, non-secret runtime settings.

Reads environment variables at import time. Keeping this separate from
``SecretsManager`` makes intent explicit: secrets are high-sensitivity
credentials, settings are operational knobs (limits, timeouts, toggles).
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    # HTTP limits
    api_rate_limit_per_min: int = _int("API_RATE_LIMIT_PER_MIN", 100)
    skill_audit_rate_limit_per_min: int = _int("SKILL_AUDIT_RATE_LIMIT_PER_MIN", 10)
    metrics_rate_limit_per_min: int = _int("METRICS_RATE_LIMIT_PER_MIN", 60)
    max_upload_bytes: int = _int("MAX_UPLOAD_BYTES", 10 * 1024 * 1024)
    api_handler_timeout_sec: float = _float("API_HANDLER_TIMEOUT_SEC", 30.0)

    # Auth toggles
    require_admin_token: bool = _bool("REQUIRE_ADMIN_TOKEN", True)
    require_metrics_token: bool = _bool("REQUIRE_METRICS_TOKEN", True)

    # Test / dev conveniences (never true in production)
    running_under_pytest: bool = bool(os.environ.get("PYTEST_CURRENT_TEST"))

    # Extraction caps
    pdf_max_bytes: int = _int("PDF_MAX_BYTES", 25 * 1024 * 1024)

    # Production hardening
    expose_openapi: bool = _bool("EXPOSE_OPENAPI", True)
    enable_hsts: bool = _bool("ENABLE_HSTS", False)
    hsts_max_age_sec: int = _int("HSTS_MAX_AGE_SEC", 31_536_000)


settings = Settings()

__all__ = ["Settings", "settings"]
