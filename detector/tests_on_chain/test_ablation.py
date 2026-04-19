"""Lockdown: the ablation bench must run and the ablated-selector
catch rate must stay at the published level (8/8). If training drift,
a model downgrade, or a signal-chain regression makes the detector
depend on the hardcoded selector flag, this test fails."""
from __future__ import annotations

from bench.ablation import run_one_side


def test_full_bench_catches_all_eight():
    """Sanity: without ablation the bench still catches every attack."""
    r = run_one_side(force_unknown_selector=False, benign_n=50, seed=1337)
    assert r["catches"] == 8, f"full bench degraded: {r}"


def test_ablation_does_not_collapse_catch_rate():
    """Force `is_known_selector=False` on every attack tx. The detector
    must still catch every attack (publicly claimed in docs/judge-qa.md).
    If this drops below 8, update the docs — don't just delete this
    test."""
    r = run_one_side(force_unknown_selector=True, benign_n=50, seed=1337)
    assert r["catches"] == 8, (
        f"ablated catch rate dropped; update docs if this is intentional: {r}"
    )


def test_ablation_zero_false_positives_on_benign():
    """FP rate must stay zero under ablation — proving we're not buying
    catch-rate with alert fatigue."""
    r = run_one_side(force_unknown_selector=True, benign_n=100, seed=1337)
    assert r["false_positives"] == 0, f"ablation introduced FPs: {r}"
