"""Smoke tests for network.applier."""
from __future__ import annotations

from pathlib import Path

from learning.blue_agent import MLP
from network.applier import apply_model_delta, apply_rule_strings


def test_apply_rule_strings_appends_new_block(tmp_path: Path):
    rules_file = tmp_path / "rules.py"
    rules_file.write_text('PATTERNS = ["existing"]\n')
    apply_rule_strings(["attacker_.*", "drain.*pool"], rules_file)
    body = rules_file.read_text()
    assert "--- auto-generated defense rules ---" in body
    assert "AUTO_RULE: attacker_.*" in body
    assert "AUTO_RULE: drain.*pool" in body


def test_apply_rule_strings_is_idempotent(tmp_path: Path):
    rules_file = tmp_path / "rules.py"
    rules_file.write_text("# empty\n")
    patterns = ["pattern_a"]
    apply_rule_strings(patterns, rules_file)
    first = rules_file.read_text()
    apply_rule_strings(patterns, rules_file)
    assert rules_file.read_text() == first


def test_apply_rule_strings_noop_for_empty_input(tmp_path: Path):
    rules_file = tmp_path / "rules.py"
    rules_file.write_text("# original\n")
    apply_rule_strings([], rules_file)
    assert rules_file.read_text() == "# original\n"


def test_apply_model_delta_adjusts_learning_rate():
    mlp = MLP(2, seed=0)
    original_lr = mlp.lr
    apply_model_delta(mlp, {"lr": 0.5})
    assert mlp.lr == original_lr * 0.5
