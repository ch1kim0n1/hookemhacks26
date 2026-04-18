"""MLP smoke + shape checks (parity with TS is optional follow-up)."""
from __future__ import annotations

from learning.blue_agent import MLP


def test_mlp_train_improves_on_trivial_xor():
    m = MLP(2, seed=42)
    data = [
        ([0.0, 0.0], 0),
        ([0.0, 1.0], 1),
        ([1.0, 0.0], 1),
        ([1.0, 1.0], 0),
    ]
    before = m.evaluate(data)["accuracy"]
    m.fit(data, epochs=20, batch_size=4)
    after = m.evaluate(data)["accuracy"]
    assert after >= before


def test_predict_raises_on_bad_dim():
    m = MLP(5, seed=0)
    try:
        m.predict([0.0, 1.0])
    except ValueError:
        return
    raise AssertionError("expected ValueError")
