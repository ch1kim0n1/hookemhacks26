"""Apply verified defense updates to local rules + MLP weights."""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from learning.blue_agent import MLP

logger = logging.getLogger(__name__)


def _skip_zk() -> bool:
    return os.getenv("SKIP_ZK_PROOF", "").strip().lower() in ("1", "true", "yes")


def verify_zk_proof(proof: bytes | None) -> bool:
    """Validate defense-update proof bytes (placeholder until Groth16 wiring)."""
    if proof is None or len(proof) == 0:
        return False
    return len(proof) >= 16


def apply_defense_bundle(
    *,
    mlp: MLP,
    rules_file: Path,
    patterns: list[str],
    zk_proof: bytes | None,
    model_delta: dict[str, Any] | None = None,
) -> bool:
    """Apply rules + optional model delta; enforce ZK unless SKIP_ZK_PROOF is set."""
    if not _skip_zk():
        if not verify_zk_proof(zk_proof):
            logger.error("defense bundle rejected: invalid or missing ZK proof")
            return False
    else:
        logger.warning("SKIP_ZK_PROOF set — skipping ZK verification (dev/demo only)")
    apply_rule_strings(patterns, rules_file)
    if model_delta:
        apply_model_delta(mlp, model_delta)
    return True


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
