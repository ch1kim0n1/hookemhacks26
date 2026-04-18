"""Derive new regex rules from Red-agent attack strings (heuristic)."""
from __future__ import annotations

import re
from collections import Counter


def longest_common_substring(strings: list[str], min_len: int = 8) -> str | None:
    if len(strings) < 2:
        return None
    base = min(strings, key=len)
    for length in range(min(len(base), 64), min_len - 1, -1):
        for start in range(len(base) - length + 1):
            sub = base[start : start + length]
            if all(sub.lower() in s.lower() for s in strings):
                return sub
    return None


def suggest_rules_from_variations(variations: list[str]) -> list[str]:
    """Return regex-like patterns for high-frequency tokens."""
    if not variations:
        return []
    patterns: list[str] = []
    lcs = longest_common_substring(variations)
    if lcs and len(lcs) >= 8:
        escaped = re.escape(lcs[:48])
        patterns.append(escaped)
    tokens = Counter()
    for v in variations:
        for w in re.split(r"\W+", v.lower()):
            if len(w) >= 6:
                tokens[w] += 1
    for w, c in tokens.most_common(5):
        if c >= 2:
            patterns.append(r"\b" + re.escape(w) + r"\b")
    return list(dict.fromkeys(patterns))
