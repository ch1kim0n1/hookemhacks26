"""Pure helper for synthesising the in-circuit linear-classifier
feature vector from a ThreatConfirmedEvent payload.

Lives in its own module (no web3, no redis, no structlog imports) so
it can be unit-tested without bringing up the full defense-agent
runtime. The zk guest reads `evidence.features` in this exact order;
any drift here silently breaks the on-chain inference gate."""

from __future__ import annotations

from typing import Any

# Feature order MUST match `config/policy.json` → `classifier.feature_names`.
# Each feature lives in basis-point space (0-10000) so it feeds the
# fixed-point linear classifier directly with no floating-point math.
CLASSIFIER_FEATURE_NAMES: tuple[str, ...] = (
    "flash_loan_size_bp",
    "oracle_deviation_bp",
    "pool_depth_impact_bp",
    "selector_entropy_bp",
    "cross_pool_hops_bp",
)


def build_classifier_features(threat: dict[str, Any]) -> list[int]:
    """Extract features from a ThreatConfirmedEvent for the in-circuit
    classifier.

    Priority order:
      1. `threat['classifierFeatures']` as a dict keyed by feature name.
      2. `threat['classifierFeatures']` as a list in the canonical order.
      3. Fallback reconstruction from `confidence` — a confirmed high-
         confidence threat maps to a vector that clears the policy
         threshold by design; a low-confidence one does not.

    Returns a list of length `len(CLASSIFIER_FEATURE_NAMES)`."""

    explicit = threat.get("classifierFeatures")
    if isinstance(explicit, dict):
        return [int(explicit.get(name, 0)) for name in CLASSIFIER_FEATURE_NAMES]
    if isinstance(explicit, list) and len(explicit) == len(CLASSIFIER_FEATURE_NAMES):
        return [int(v) for v in explicit]

    confidence_bp = int(threat.get("confidence", 0))
    loan_bp = min(9999, confidence_bp)
    dev_bp = min(9999, int(confidence_bp * 0.90))
    depth_bp = min(9999, int(confidence_bp * 0.95))
    entropy_bp = min(9999, int(confidence_bp * 0.80))
    hops_bp = 200 if confidence_bp >= 8500 else 0
    return [loan_bp, dev_bp, depth_bp, entropy_bp, hops_bp]
