"""Smoke-test the historical-attack replay harness.

Runs a single attack + 5 benign txs through a minimally-warmed operator.
Protects the benchmark corpus from bit-rotting (import breakage, schema
drift on Operator, etc.) without bloating CI to a multi-second run.
"""
from __future__ import annotations

import random

from bench.attack_corpus import HISTORICAL_ATTACKS
from bench.replay import replay_attack, replay_benign
from detector.on_chain.operator import Operator


def test_bench_attack_corpus_is_non_empty_and_well_formed() -> None:
    assert len(HISTORICAL_ATTACKS) >= 6
    for a in HISTORICAL_ATTACKS:
        assert a.loss_usd_millions > 0
        assert a.flash_loan_wei > 0
        assert a.attack_selector_hex and len(a.attack_selector_hex) == 8
        assert a.attacker_eoa.startswith("0x")
        assert a.oracle.startswith("0x")


def test_bench_replay_catches_a_canonical_attack() -> None:
    op = Operator(operator_id="alpha", seed=1337)
    op.warm_up(n_normal=60, n_attack=40, n_seq_normal=120)
    rng = random.Random(42)
    # Pick bZx #1 — smallest kill-chain, deterministic.
    result = replay_attack(op, HISTORICAL_ATTACKS[0], rng=rng)
    assert result.caught, f"expected catch, got {result}"
    assert result.level in {"candidate", "confirmed"}
    assert result.confidence_bp >= 6000
    assert result.latency_ms_exploit_tx > 0


def test_bench_benign_stream_produces_low_fp_rate() -> None:
    op = Operator(operator_id="alpha", seed=1337)
    op.warm_up(n_normal=60, n_attack=40, n_seq_normal=120)
    rng = random.Random(7)
    benign = replay_benign(op, n=25, rng=rng)
    # 25 random benign txs shouldn't trigger the state machine at all.
    assert benign["false_positives"] == 0
    assert benign["ms_per_tx"] > 0
