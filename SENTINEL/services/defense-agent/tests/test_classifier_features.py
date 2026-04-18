"""defense-agent: unit tests for the in-circuit classifier feature
synthesis. Asserts that a confirmed high-confidence threat produces a
feature vector that clears the policy.json threshold, and a benign
(sub-threshold) one does not — so the ZK guest's on-chain-inference
gate behaves as the policy specifies without any off-chain help."""

import json
from pathlib import Path

from defense_agent.classifier_features import (
    CLASSIFIER_FEATURE_NAMES,
    build_classifier_features,
)

POLICY = json.loads(
    (Path(__file__).resolve().parents[3] / "config" / "policy.json").read_text()
)


def _score(features: list[int]) -> int:
    clf = POLICY["classifier"]
    assert list(clf["feature_names"]) == list(CLASSIFIER_FEATURE_NAMES), (
        "feature order drift between policy.json and defense-agent"
    )
    s = clf["bias"]
    for w, f in zip(clf["weights"], features):
        s += w * f
    return s


def test_features_have_exact_length_for_classifier():
    features = build_classifier_features({"confidence": 9500})
    assert len(features) == len(CLASSIFIER_FEATURE_NAMES)


def test_high_confidence_threat_clears_threshold():
    # Mirrors the FLASH_LOAN_ORACLE_MANIP happy path (doc 05 §Scenario A).
    features = build_classifier_features({"confidence": 9500})
    assert _score(features) >= POLICY["classifier"]["threshold"]


def test_benign_confidence_fails_threshold():
    # A low-confidence event must NOT produce a vector that clears the
    # classifier. If this ever flips, the on-chain inference gate is
    # no longer a gate — it's a rubber stamp.
    features = build_classifier_features({"confidence": 3000})
    assert _score(features) < POLICY["classifier"]["threshold"]


def test_explicit_feature_dict_is_respected():
    features = build_classifier_features(
        {
            "confidence": 0,
            "classifierFeatures": {
                "flash_loan_size_bp": 9500,
                "oracle_deviation_bp": 8000,
                "pool_depth_impact_bp": 9000,
                "selector_entropy_bp": 7500,
                "cross_pool_hops_bp": 200,
            },
        }
    )
    assert features == [9500, 8000, 9000, 7500, 200]


def test_explicit_feature_list_is_respected():
    features = build_classifier_features(
        {"confidence": 0, "classifierFeatures": [1, 2, 3, 4, 5]}
    )
    assert features == [1, 2, 3, 4, 5]


# --- MLP decision-boundary lockdown ---------------------------------------
# The i32 MLP weights checked into config/policy.json must produce
# positive output on high-confidence threats and negative output on
# low-confidence ones. If training drift breaks this, we ship a broken
# on-chain gate and the demo fails silently.


def _mlp_forward(mlp: dict, features: list[int]) -> int:
    """Bit-exact Python mirror of zk/shared/src/nn.rs::forward."""
    shift = mlp["shift_bits"]
    hidden = []
    for j, row in enumerate(mlp["hidden"]["weights"]):
        acc = sum(w * f for w, f in zip(row, features))
        v = (acc >> shift) + mlp["hidden"]["biases"][j]
        hidden.append(max(0, v))
    acc = sum(w * h for w, h in zip(mlp["output"]["weights"][0], hidden))
    return (acc >> shift) + mlp["output"]["biases"][0]


def test_shipped_mlp_passes_attack_features():
    mlp = POLICY["mlp"]
    attack = build_classifier_features({"confidence": 9500})
    score = _mlp_forward(mlp, attack)
    assert score >= mlp["threshold"], (
        f"attack features must clear MLP threshold; got {score}"
    )


def test_shipped_mlp_rejects_benign_features():
    mlp = POLICY["mlp"]
    benign = build_classifier_features({"confidence": 3000})
    score = _mlp_forward(mlp, benign)
    assert score < mlp["threshold"], (
        f"benign features must fail MLP threshold; got {score}"
    )


def test_shipped_mlp_feature_names_match_defense_agent():
    mlp = POLICY["mlp"]
    assert tuple(mlp["feature_names"]) == CLASSIFIER_FEATURE_NAMES, (
        "feature-name drift between policy.json MLP and defense-agent"
    )
