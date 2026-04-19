"""Structured logging helpers.

Two supported formats:

* ``plain`` (default) — human-readable single-line records for local dev.
* ``json``            — one JSON object per line; friendly for log shippers.

Toggle with ``LOG_FORMAT=json`` or pass ``format_="json"`` to :func:`setup_logging`.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time

_RESERVED = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "asctime", "taskName",
}


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_"):
                continue
            try:
                json.dumps(value)
                payload[key] = value
            except TypeError:
                payload[key] = repr(value)
        return json.dumps(payload, default=str)


def setup_logging(level: str | int | None = None, format_: str | None = None) -> None:
    """Configure the root logger. Idempotent (safe to call multiple times)."""
    level = level or os.environ.get("LOG_LEVEL", "INFO")
    fmt = (format_ or os.environ.get("LOG_FORMAT", "plain")).lower()

    root = logging.getLogger()
    root.setLevel(level)
    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler(sys.stdout)
    if fmt == "json":
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s %(name)s: %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S",
            )
        )
    root.addHandler(handler)


__all__ = ["JSONFormatter", "setup_logging"]
