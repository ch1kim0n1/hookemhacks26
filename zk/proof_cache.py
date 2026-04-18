"""In-memory proof cache to avoid redundant prover calls (same public inputs)."""

from __future__ import annotations

import hashlib
import json
from threading import Lock
from typing import Any

_lock = Lock()
_store: dict[str, dict[str, Any]] = {}
_MAX = 512


def cache_key(public_inputs: list[str] | list[bytes]) -> str:
    """Stable digest for a set of public inputs."""
    normalized: list[str] = []
    for x in public_inputs:
        if isinstance(x, bytes):
            normalized.append("0x" + x.hex())
        else:
            normalized.append(str(x))
    raw = json.dumps(normalized, sort_keys=True).encode()
    return hashlib.sha256(raw).hexdigest()


def get_cached(key: str) -> dict[str, Any] | None:
    with _lock:
        return _store.get(key)


def set_cached(key: str, payload: dict[str, Any]) -> None:
    with _lock:
        if len(_store) >= _MAX:
            # Drop arbitrary oldest half (simple bounded cache)
            for i, k in enumerate(list(_store.keys())):
                if i < _MAX // 2:
                    _store.pop(k, None)
        _store[key] = payload
