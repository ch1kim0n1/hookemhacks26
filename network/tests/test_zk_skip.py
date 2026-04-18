"""Defense applier respects SKIP_ZK_PROOF."""

from __future__ import annotations

from pathlib import Path

import pytest

from learning.blue_agent import MLP
from network.applier import apply_defense_bundle


def test_apply_defense_skips_zk_when_env_set(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SKIP_ZK_PROOF", "true")
    mlp = MLP(5, seed=0)
    rules = tmp_path / "rules.py"
    rules.write_text("PATTERNS = []\n")
    ok = apply_defense_bundle(
        mlp=mlp,
        rules_file=rules,
        patterns=["x"],
        zk_proof=None,
    )
    assert ok is True


def test_apply_defense_rejects_missing_proof_in_prod(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("SKIP_ZK_PROOF", raising=False)
    mlp = MLP(5, seed=0)
    rules = tmp_path / "rules.py"
    rules.write_text("PATTERNS = []\n")
    ok = apply_defense_bundle(
        mlp=mlp,
        rules_file=rules,
        patterns=["x"],
        zk_proof=None,
    )
    assert ok is False
