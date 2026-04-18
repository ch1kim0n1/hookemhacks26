"""Rule-extractor smoke tests."""
from __future__ import annotations

from learning.rule_extractor import longest_common_substring, suggest_rules_from_variations


def test_returns_empty_list_when_no_variations():
    assert suggest_rules_from_variations([]) == []


def test_extracts_longest_common_substring_as_pattern():
    variations = [
        "attacker_sequence_alpha_9421",
        "attacker_sequence_bravo_3317",
        "attacker_sequence_delta_8800",
    ]
    patterns = suggest_rules_from_variations(variations)
    joined = "".join(patterns)
    # LCS "attacker_sequence" must show up (escaped).
    assert "attacker_sequence" in joined.replace("\\", "")


def test_repeated_tokens_become_word_boundary_rules():
    variations = [
        "oraclePing flood zk_circuit_bypass",
        "flood oraclePing denial_of_service",
        "zk_circuit_bypass oraclePing again",
    ]
    patterns = suggest_rules_from_variations(variations)
    assert any("oracleping" in p.lower() for p in patterns)


def test_longest_common_substring_below_threshold_returns_none():
    assert longest_common_substring(["abc", "xyz"], min_len=8) is None
