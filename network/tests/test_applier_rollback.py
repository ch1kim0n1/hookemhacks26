"""Rollback path for defense applier (issue #113)."""

from __future__ import annotations

from pathlib import Path

from learning.blue_agent import MLP
from network.applier import apply_defense_bundle, rollback_last_defense


def test_rollback_restores_rules_after_apply(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("SKIP_ZK_PROOF", "true")
    rules = tmp_path / "rules.py"
    rules.write_text("# original\n", encoding="utf-8")
    mlp = MLP(5, seed=0)
    assert apply_defense_bundle(
        mlp=mlp,
        rules_file=rules,
        patterns=["pat_a"],
        zk_proof=None,
    )
    assert "AUTO_RULE" in rules.read_text()
    assert rollback_last_defense(rules_file=rules)
    assert rules.read_text() == "# original\n"
