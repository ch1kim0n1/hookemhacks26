"""Apply verified defense updates to local rules + MLP weights."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from learning.blue_agent import MLP

logger = logging.getLogger(__name__)


def apply_rule_strings(
    new_patterns: list[str],
    rules_file: Path,
) -> None:
    """Append patterns as comments to rules module (demo-safe)."""
    if not new_patterns:
        return
    text = rules_file.read_text()
    block = "\n# --- auto-generated defense rules ---\n"
    for p in new_patterns:
        block += f"# AUTO_RULE: {p}\n"
    if block not in text:
        rules_file.write_text(text + block)


def apply_model_delta(mlp: MLP, delta: dict[str, Any]) -> None:
    """Apply serialized weight delta — stub for hashed deltas."""
    lr = float(delta.get("lr", 1.0))
    mlp.set_learning_rate(mlp.lr * lr)


class DefenseApplier:
    """Placeholder for broadcasting PauseController.activate via PolicyRegistry path."""

    def __init__(self, rpc_url: str | None = None) -> None:
        self.rpc_url = rpc_url

    def apply_pause(self, target: str, event_id: str) -> bool:
        logger.info("defense_applier: would pause target=%s event=%s", target, event_id)
        return True
