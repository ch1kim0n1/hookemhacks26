"""Registers OpenClaw pre-tool hooks and dispatches to the detection pipeline.

All hooked tools share one entrypoint with a hard wall-clock timeout so agents
never hang if extractors or the ML stack misbehave.
"""

from __future__ import annotations

import concurrent.futures
import logging
import os
import time
from typing import Final

from .handler import intercept
from .latency_budgets import HOOK_INTERCEPT_MS

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = float(os.getenv("CLAWGUARD_HOOK_TIMEOUT_SEC", "3.0"))

# Tools that map to inbound content modalities (aligned with SKILL.md pre_tool list).
HOOKED_TOOLS: Final[frozenset[str]] = frozenset(
    {
        "email_read",
        "web_fetch",
        "file_read",
        "image_view",
        "pdf_read",
        "audio_listen",
    }
)


def intercept_entry(
    tool_name: str,
    content: str | bytes,
    content_type: str | None = None,
    filename: str | None = None,
    enabled: bool = True,
    timeout_sec: float | None = None,
) -> dict:
    """Single hook entry for OpenClaw: runs `intercept` under a timeout.

    On timeout, returns ``action="pass"`` with a low-confidence verdict (graceful
    degradation). ``ContentBlocked`` is re-raised from the worker thread when
    appropriate.

    Timeout defaults to ``CLAWGUARD_HOOK_TIMEOUT_SEC`` (default 3.0s) so OCR / PDF
    extraction can finish; override per-call with ``timeout_sec``.
    """
    if timeout_sec is None:
        timeout_sec = _DEFAULT_TIMEOUT
    if not enabled:
        return intercept(
            tool_name, content, content_type=content_type, filename=filename, enabled=False
        )

    def _run() -> dict:
        return intercept(
            tool_name, content, content_type=content_type, filename=filename, enabled=True
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        fut = pool.submit(_run)
        t0 = time.monotonic()
        try:
            out = fut.result(timeout=timeout_sec)
            elapsed_ms = (time.monotonic() - t0) * 1000
            if elapsed_ms > HOOK_INTERCEPT_MS * 0.85:
                logger.warning(
                    "hook_intercept slow: tool=%s elapsed_ms=%.0f budget_ms=%s",
                    tool_name,
                    elapsed_ms,
                    HOOK_INTERCEPT_MS,
                )
            return out
        except concurrent.futures.TimeoutError:
            return {
                "action": "pass",
                "content": content if isinstance(content, str) else content.decode("utf-8", errors="replace"),
                "verdict": {
                    "verdict": "pass",
                    "confidence": 0.0,
                    "reasons": [f"ClawGuard timeout ({timeout_sec}s); allowed through"],
                    "layer_reached": "timeout",
                },
                "extraction": {"modality": "timeout", "text": "", "manifest": []},
            }


def is_hooked_tool(tool_name: str) -> bool:
    return tool_name in HOOKED_TOOLS
