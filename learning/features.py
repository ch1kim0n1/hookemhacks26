"""Feature extraction for BlueAgent / MLP from attack text (issue #96)."""

from __future__ import annotations

import re


def attack_feature_vector(seed: str, variants: list[str] | None = None) -> list[float]:
    """Five reproducible floats in [0,1] derived from seed + optional variants."""
    text = seed or ""
    n = max(len(text), 1)
    length_norm = min(len(text) / 10_000.0, 1.0)
    zw = sum(text.count(c) for c in "\u200b\u200c\u200d\ufeff\u2060") / n
    toks = len(re.findall(r"\w+", text.lower()))
    token_density = min(toks / 500.0, 1.0)
    low = text.lower()
    needles = (
        "ignore all previous",
        "disregard",
        "system prompt",
        "you are now",
        "override",
    )
    override_signal = sum(1 for p in needles if p in low) / len(needles)
    diversity = 0.0
    if variants:
        uniq = len({v.strip()[:120] for v in variants if v.strip()})
        diversity = min(uniq / max(len(variants), 1), 1.0)
    vec = [length_norm, zw, token_density, override_signal, diversity]
    return [float(min(max(x, 0.0), 1.0)) for x in vec]
