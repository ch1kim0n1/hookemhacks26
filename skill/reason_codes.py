"""Normalized rejection taxonomy for API, dashboard, and audits (issue #109)."""

from __future__ import annotations

from typing import Any

# Stable machine codes; map human reasons heuristically.
INSTRUCTION_OVERRIDE = "CG_INSTRUCTION_OVERRIDE"
ROLE_HIJACK = "CG_ROLE_HIJACK"
EXFILTRATION = "CG_EXFILTRATION"
OBFUSCATION = "CG_OBFUSCATION"
ML_CLASSIFIER = "CG_ML_CLASSIFIER"
LLM_JUDGE = "CG_LLM_JUDGE"
KNOWN_THREAT_CACHE = "CG_KNOWN_THREAT"
SANITIZE_LOW_CONF = "CG_SANITIZE_LOW_CONF"
UNKNOWN = "CG_UNKNOWN"


def infer_codes(reasons: list[str], *, layer: str | None = None) -> list[str]:
    codes: list[str] = []
    blob = " ".join(reasons).lower()
    if layer == "cache" or "known threat" in blob:
        codes.append(KNOWN_THREAT_CACHE)
    if "rule match" in blob or "override" in blob or "ignore" in blob:
        codes.append(INSTRUCTION_OVERRIDE)
    if "role" in blob or "you are now" in blob:
        codes.append(ROLE_HIJACK)
    if "classifier" in blob or "ml " in blob:
        codes.append(ML_CLASSIFIER)
    if "judge" in blob or "llm" in blob:
        codes.append(LLM_JUDGE)
    if "exfil" in blob or "system prompt" in blob or "reveal" in blob:
        codes.append(EXFILTRATION)
    if "base64" in blob or "zero" in blob or "unicode" in blob:
        codes.append(OBFUSCATION)
    if not codes:
        codes.append(UNKNOWN)
    return list(dict.fromkeys(codes))


def enrich_verdict(verdict: dict[str, Any]) -> dict[str, Any]:
    """Mutate verdict with ``reason_codes`` + ``reason_family`` (primary code)."""
    reasons = verdict.get("reasons") or []
    if not isinstance(reasons, list):
        reasons = [str(reasons)]
    layer = verdict.get("layer_reached")
    codes = infer_codes([str(r) for r in reasons], layer=str(layer) if layer else None)
    verdict["reason_codes"] = codes
    priority = (
        KNOWN_THREAT_CACHE,
        INSTRUCTION_OVERRIDE,
        ML_CLASSIFIER,
        LLM_JUDGE,
        EXFILTRATION,
        OBFUSCATION,
        ROLE_HIJACK,
        SANITIZE_LOW_CONF,
        UNKNOWN,
    )
    verdict["reason_family"] = next((p for p in priority if p in codes), codes[0])
    return verdict
