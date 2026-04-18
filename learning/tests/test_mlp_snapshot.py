"""Seeded regression snapshot for `learning.blue_agent.MLP`.

Pins the exact numerical output of a deterministically-seeded MLP before
and after a fixed training run. Acts as a tripwire: any change in He
init, sigmoid numerics, matmul ordering, or SGD/momentum math will flip
one of these digits and fail CI — giving us a chance to verify the change
is intentional before propagating it to downstream policy hashes.
"""
from __future__ import annotations

from learning.blue_agent import MLP


def _fixed_mlp() -> MLP:
    return MLP(5, seed=1337)


def test_initial_weights_match_seeded_reference():
    m = _fixed_mlp()
    # He init with seed=1337 produces these leading weights. Do NOT
    # adjust these values — if they change, investigate the cause.
    assert round(m.W1[0][0], 12) == -0.607242288736
    assert round(m.W3[0][0], 12) == 0.886622965938
    # Biases always start at zero.
    assert m.b1 == [0.0] * 8
    assert m.b2 == [0.0] * 4
    assert m.b3 == [0.0]


def test_untrained_prediction_matches_snapshot():
    m = _fixed_mlp()
    # Zero input → exact 0.5 because sigmoid(0 + b3[0]=0) = 0.5.
    assert m.predict([0.0, 0.0, 0.0, 0.0, 0.0]) == 0.5
    # Mixed input → deterministic value pinned to the seeded weights.
    assert round(m.predict([1.0, 0.5, -0.5, 0.25, -0.25]), 12) == 0.513127349823


def test_post_training_metrics_match_snapshot():
    m = _fixed_mlp()
    data = [
        ([1.0, 0.0, 0.0, 0.0, 0.0], 1),
        ([0.0, 1.0, 0.0, 0.0, 0.0], 1),
        ([0.0, 0.0, 1.0, 0.0, 0.0], 0),
        ([0.0, 0.0, 0.0, 1.0, 0.0], 0),
    ]
    metrics = m.fit(data, epochs=3, batch_size=2)
    assert len(metrics) == 3
    # Loss and accuracy are rounded by fit() itself.
    assert metrics[-1].loss == 0.711301
    assert metrics[-1].accuracy == 0.5
    assert metrics[-1].examples == 4


def test_post_training_prediction_is_deterministic():
    m = _fixed_mlp()
    data = [
        ([1.0, 0.0, 0.0, 0.0, 0.0], 1),
        ([0.0, 1.0, 0.0, 0.0, 0.0], 1),
        ([0.0, 0.0, 1.0, 0.0, 0.0], 0),
        ([0.0, 0.0, 0.0, 1.0, 0.0], 0),
    ]
    m.fit(data, epochs=3, batch_size=2)
    pred = m.predict([0.0, 0.0, 0.0, 0.0, 0.0])
    assert round(pred, 10) == 0.4974174547


def test_two_instances_with_same_seed_agree():
    a = MLP(5, seed=42)
    b = MLP(5, seed=42)
    assert a.W1 == b.W1
    assert a.W2 == b.W2
    assert a.W3 == b.W3
    x = [0.1, 0.2, 0.3, 0.4, 0.5]
    assert a.predict(x) == b.predict(x)
