"""Apply verified defense updates to local rules + MLP weights."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from learning.blue_agent import MLP
from learning.rule_extractor import suggest_rules_from_variations


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
