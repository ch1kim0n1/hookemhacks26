"""Apply verified defense updates to local rules + MLP weights."""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from learning.blue_agent import MLP

logger = logging.getLogger(__name__)

_BACKUP_SUFFIX = ".clawguard.bak"


def _skip_zk() -> bool:
    return os.getenv("SKIP_ZK_PROOF", "").strip().lower() in ("1", "true", "yes")


def verify_zk_proof(proof: bytes | None) -> bool:
    """Validate defense-update proof bytes (placeholder until Groth16 wiring)."""
    return not (proof is None or len(proof) < 32)


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
        logger.warning(
            "SKIP_ZK_PROOF active — ZK verification bypassed (UNSAFE; dev/demo only)"
        )
    backup_path = rules_file.with_name(rules_file.name + _BACKUP_SUFFIX)
    prior = rules_file.read_text(encoding="utf-8") if rules_file.is_file() else ""
    try:
        backup_path.write_text(prior, encoding="utf-8")
    except OSError as exc:
        logger.error("defense bundle: could not write backup %s: %s", backup_path, exc)
        return False
    try:
        apply_rule_strings(patterns, rules_file)
        if model_delta:
            apply_model_delta(mlp, model_delta)
    except Exception as exc:
        logger.exception("defense bundle apply failed; rolling back rules file: %s", exc)
        try:
            rules_file.write_text(prior, encoding="utf-8")
        except OSError:
            pass
        return False
    return True


def rollback_last_defense(*, rules_file: Path) -> bool:
    """Restore rules file from ``.clawguard.bak`` (issue #113)."""
    backup_path = rules_file.with_name(rules_file.name + _BACKUP_SUFFIX)
    if not backup_path.is_file():
        logger.warning("rollback: no backup at %s", backup_path)
        return False
    try:
        rules_file.write_text(backup_path.read_text(encoding="utf-8"), encoding="utf-8")
        logger.info("rollback: restored %s from backup", rules_file)
        return True
    except OSError as exc:
        logger.error("rollback failed: %s", exc)
        return False


def apply_rule_strings(
    new_patterns: list[str],
    rules_file: Path,
) -> None:
    """Append patterns as comments to rules module (demo-safe)."""
    if not new_patterns:
        return
    text = rules_file.read_text(encoding="utf-8")
    block = "\n# --- auto-generated defense rules ---\n"
    for p in new_patterns:
        block += f"# AUTO_RULE: {p}\n"
    if block not in text:
        rules_file.write_text(text + block, encoding="utf-8")


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
