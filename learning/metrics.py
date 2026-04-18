"""In-process learning loop metrics for the dashboard API."""

from __future__ import annotations

import copy
import time
from threading import Lock
from typing import Any

_lock = Lock()
_state: dict[str, Any] = {
    "variations_generated": 0,
    "rules_extracted": 0,
    "rounds_completed": 0,
    "accuracy_trend": [],
    "model_updates": [],
    "last_publish_ok": None,
    "last_update_ts": None,
}


def record_round(
    *,
    variations: int,
    rules: int,
    blue_score: float,
    publish_ok: bool | None,
) -> None:
    with _lock:
        _state["variations_generated"] += variations
        _state["rules_extracted"] += rules
        _state["rounds_completed"] += 1
        trend: list = _state["accuracy_trend"]
        trend.append(float(blue_score))
        _state["accuracy_trend"] = trend[-24:]
        _state["last_publish_ok"] = publish_ok
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        _state["last_update_ts"] = ts
        updates: list = _state["model_updates"]
        updates.append(
            {
                "timestamp": ts,
                "source": "orchestrator",
                "publish_ok": publish_ok,
            }
        )
        _state["model_updates"] = updates[-50:]


def snapshot() -> dict[str, Any]:
    with _lock:
        return copy.deepcopy(_state)
