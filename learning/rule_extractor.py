"""Derive new regex rules from Red-agent attack strings (heuristic)."""
from __future__ import annotations

import re
from collections import Counter

# Very common tokens that make an LCS too generic for auto-blocking.
# Benign samples for auto-rule precision checks (issue #97).
DEFAULT_BENIGN_SAMPLES = [
    "Please summarize this article for a general audience.",
    "Draft a polite follow-up email confirming Tuesday's meeting time.",
    "What are three pros and cons of switching to electric vehicles?",
    "Explain how HTTP caching works using simple terms.",
    "List action items from the attached meeting notes.",
]


_GENERIC_TOKENS = frozenset(
    {
        "sell",
        "all",
        "buy",
        "the",
        "now",
        "immediate",
        "and",
        "or",
        "for",
        "a",
        "an",
        "to",
        "of",
        "in",
        "on",
        "at",
        "is",
        "it",
        "as",
        "be",
    }
)


def longest_common_substring(strings: list[str], min_len: int = 12) -> str | None:
    if len(strings) < 2:
        return None
    base = min(strings, key=len)
    for length in range(min(len(base), 64), min_len - 1, -1):
        for start in range(len(base) - length + 1):
            sub = base[start : start + length]
            if all(sub.lower() in s.lower() for s in strings):
                return sub
    return None


def _lcs_is_substantive(phrase: str) -> bool:
    """Reject LCS that are mostly stopwords (e.g. 'sell all')."""
    tokens = [t for t in re.split(r"[\W_]+", phrase.lower()) if len(t) >= 2]
    if len(tokens) < 2:
        return False
    substantive = [t for t in tokens if t not in _GENERIC_TOKENS and len(t) >= 4]
    return len(substantive) >= 2


def filter_patterns_by_precision(
    patterns: list[str],
    benign_samples: list[str] | None = None,
) -> list[str]:
    """Drop regex patterns that match clean text (false positives)."""
    samples = benign_samples if benign_samples is not None else DEFAULT_BENIGN_SAMPLES
    good: list[str] = []
    for p in patterns:
        if not p or len(p) < 4:
            continue
        try:
            rx = re.compile(p, re.I)
        except re.error:
            continue
        if any(rx.search(b) for b in samples):
            continue
        good.append(p)
    return good


def suggest_rules_from_variations(variations: list[str]) -> list[str]:
    """Return regex-like patterns for high-frequency tokens."""
    if not variations:
        return []
    patterns: list[str] = []
    lcs = longest_common_substring(variations, min_len=12)
    if lcs and _lcs_is_substantive(lcs):
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
    return filter_patterns_by_precision(list(dict.fromkeys(patterns)))


def extract_from_variations(variations: list[str], min_support: int = 1) -> list[str]:
    """Return normalized strings that appear often enough (orchestrator hook)."""
    if not variations:
        return []
    seen: dict[str, int] = {}
    for v in variations:
        key = v.strip()[:120]
        if key:
            seen[key] = seen.get(key, 0) + 1
    return [k for k, c in seen.items() if c >= min_support]
