#!/usr/bin/env python3
"""Train the tiny policy MLP offline and emit quantised i32 weights
into config/policy.json.

Reproducible: fixed seed, synthetic corpus tuned against the
defense-agent feature synthesiser. Pure stdlib (no numpy) so anyone
can re-run it without extra deps.

Run: python3 scripts/train-policy-mlp.py
"""
from __future__ import annotations

import json
import math
import pathlib
import random

REPO = pathlib.Path(__file__).resolve().parents[1]
POLICY_PATH = REPO / "config" / "policy.json"

FEATURE_NAMES = [
    "flash_loan_size_bp",
    "oracle_deviation_bp",
    "pool_depth_impact_bp",
    "selector_entropy_bp",
    "cross_pool_hops_bp",
]


def synth(confidence_bp: int) -> list[float]:
    """Mirror defense_agent.classifier_features.build_classifier_features,
    in float space so training math stays sane. Scaled to [0, 1] so
    magnitudes aren't 10^4 during SGD."""
    c = confidence_bp
    loan = min(9999, c)
    dev = min(9999, int(c * 0.90))
    depth = min(9999, int(c * 0.95))
    entropy = min(9999, int(c * 0.80))
    hops = 200 if c >= 8500 else 0
    return [loan / 10000.0, dev / 10000.0, depth / 10000.0, entropy / 10000.0, hops / 10000.0]


def make_corpus(n_attack: int = 400, n_benign: int = 400, seed: int = 0xC0FFEE):
    r = random.Random(seed)
    xs, ys = [], []
    for _ in range(n_attack):
        c = r.randint(8500, 9800)
        xs.append(synth(c))
        ys.append(1.0)
    for _ in range(n_benign):
        c = r.randint(0, 5000)
        xs.append(synth(c))
        ys.append(0.0)
    z = list(zip(xs, ys))
    r.shuffle(z)
    xs, ys = zip(*z)
    return list(xs), list(ys)


def sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    ex = math.exp(x)
    return ex / (1.0 + ex)


def train(hidden: int = 4, epochs: int = 60, lr: float = 0.5) -> dict:
    """Plain SGD over a [0,1]-normalised feature space.

    Default hyperparams converge to ≥99% train accuracy on the
    synthetic corpus in well under a second — this is a gate, not
    a grand-challenge benchmark."""
    rng = random.Random(0xBEEF)
    xs, ys = make_corpus()

    # He init.
    def rand_mat(rows: int, cols: int) -> list[list[float]]:
        scale = (2.0 / cols) ** 0.5
        return [[rng.gauss(0.0, scale) for _ in range(cols)] for _ in range(rows)]

    W1 = rand_mat(hidden, 5)
    b1 = [0.0] * hidden
    W2 = rand_mat(1, hidden)
    b2 = [0.0]

    for epoch in range(epochs):
        # Shuffle each epoch for SGD noise.
        idx = list(range(len(xs)))
        rng.shuffle(idx)
        for k in idx:
            x = xs[k]
            y = ys[k]

            h_pre = [sum(W1[j][i] * x[i] for i in range(5)) + b1[j] for j in range(hidden)]
            h = [max(0.0, v) for v in h_pre]
            o = sum(W2[0][j] * h[j] for j in range(hidden)) + b2[0]
            p = sigmoid(o)

            d_o = p - y
            d_W2_row = [d_o * h[j] for j in range(hidden)]
            d_b2 = d_o
            d_h = [W2[0][j] * d_o for j in range(hidden)]
            d_h_pre = [d_h[j] if h_pre[j] > 0 else 0.0 for j in range(hidden)]
            d_W1 = [[d_h_pre[j] * x[i] for i in range(5)] for j in range(hidden)]
            d_b1 = d_h_pre

            for j in range(hidden):
                for i in range(5):
                    W1[j][i] -= lr * d_W1[j][i]
                b1[j] -= lr * d_b1[j]
                W2[0][j] -= lr * d_W2_row[j]
            b2[0] -= lr * d_b2

    # Sanity: training accuracy.
    correct = 0
    for x, y in zip(xs, ys):
        h = [
            max(0.0, sum(W1[j][i] * x[i] for i in range(5)) + b1[j]) for j in range(hidden)
        ]
        o = sum(W2[0][j] * h[j] for j in range(hidden)) + b2[0]
        pred = 1.0 if sigmoid(o) >= 0.5 else 0.0
        if pred == y:
            correct += 1
    acc = correct / len(xs)
    print(f"  train accuracy: {acc:.4f}")

    return {"W1": W1, "b1": b1, "W2": W2, "b2": b2, "hidden": hidden, "acc": acc}


def quantise(model: dict, shift_bits: int, feature_scale: int) -> dict:
    """Quantise float weights trained on [0,1]-normalised features to
    i32 for an integer-feature guest running in `2^shift_bits` fixed
    point.

    Layer 1 (features `x_bp ∈ [0, 10000]` in, hidden in 2^S scale out,
    where S = shift_bits):
      (Σ W1_q · x_bp) >> S  +  b1_q
      ≈ 2^S · Σ W1 · x_float  +  2^S · b1
      ⇒ W1_q = round(W1 · 2^(2S) / feature_scale)
        b1_q = round(b1 · 2^S)

    Layer 2 (hidden in 2^S scale in, output in 2^S scale out):
      (Σ W2_q · h_q) >> S  +  b2_q
      ≈ 2^S · Σ W2 · h  +  2^S · b2
      ⇒ W2_q = round(W2 · 2^S)
        b2_q = round(b2 · 2^S)

    The output is in 2^S scale; `threshold: 0` stays 0 because the
    sign of a sigmoid's logit survives any positive multiply.
    """
    s = shift_bits
    w1_scale = (1 << (2 * s)) / feature_scale
    bias_scale = 1 << s
    w2_scale = 1 << s

    def clamp_i32(v: int) -> int:
        return max(-2_000_000_000, min(2_000_000_000, v))

    W1_q = [[clamp_i32(round(w * w1_scale)) for w in row] for row in model["W1"]]
    b1_q = [clamp_i32(round(b * bias_scale)) for b in model["b1"]]
    W2_q = [[clamp_i32(round(w * w2_scale)) for w in row] for row in model["W2"]]
    b2_q = [clamp_i32(round(b * bias_scale)) for b in model["b2"]]
    return {"W1": W1_q, "b1": b1_q, "W2": W2_q, "b2": b2_q, "shift_bits": shift_bits}


def verify_quantised(qm: dict, hidden: int) -> tuple[int, int]:
    """Replay forward() in Python with integer math to confirm the
    decision boundary survived quantisation. Returns (attack_score,
    benign_score)."""
    shift = qm["shift_bits"]

    def fwd(features_bp: list[int]) -> int:
        h = []
        for j in range(hidden):
            acc = sum(qm["W1"][j][i] * features_bp[i] for i in range(5))
            v = (acc >> shift) + qm["b1"][j]
            h.append(max(0, v))
        acc = sum(qm["W2"][0][j] * h[j] for j in range(hidden))
        return (acc >> shift) + qm["b2"][0]

    # Use exact feature synth that production will produce at runtime.
    def synth_bp(c: int) -> list[int]:
        return [
            min(9999, c),
            min(9999, int(c * 0.90)),
            min(9999, int(c * 0.95)),
            min(9999, int(c * 0.80)),
            200 if c >= 8500 else 0,
        ]

    return fwd(synth_bp(9500)), fwd(synth_bp(3000))


def main() -> None:
    print("training 5→4→1 MLP (stdlib SGD, seed=0xBEEF)...")
    model = train()
    # shift_bits = 14 → W1 multiplier = 2^28/10000 ≈ 26843, giving
    # ~4 digits of precision on float weights near 1 while keeping W1_q
    # under the 2e9 i32 clamp and the matmul accumulator well within
    # i64. Biases get 2^14 = 16384 scale, also fine.
    shift_bits = 14
    feature_scale = 10000
    qm = quantise(model, shift_bits=shift_bits, feature_scale=feature_scale)
    attack_score, benign_score = verify_quantised(qm, hidden=model["hidden"])
    print(f"  quantised scores — attack(c=9500): {attack_score}, benign(c=3000): {benign_score}")
    if attack_score < 0 or benign_score >= 0:
        raise SystemExit(
            f"quantisation broke decision boundary; attack={attack_score} "
            f"benign={benign_score}. Adjust shift_bits or retrain."
        )

    policy = json.loads(POLICY_PATH.read_text())
    policy["mlp"] = {
        "feature_names": FEATURE_NAMES,
        "hidden": {"weights": qm["W1"], "biases": qm["b1"]},
        "output": {"weights": qm["W2"], "biases": qm["b2"]},
        "threshold": 0,
        "shift_bits": qm["shift_bits"],
    }
    POLICY_PATH.write_text(json.dumps(policy, indent=4) + "\n")
    print(f"  wrote {POLICY_PATH}")
    print("  run `pnpm biome format --write config/policy.json` if the")
    print("  pre-commit hook complains about JSON array formatting.")


if __name__ == "__main__":
    main()
