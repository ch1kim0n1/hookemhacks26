"""Three-layer detection pipeline: rules -> classifier -> LLM judge."""

import hashlib
import re

from .judge import judge
from .rules import max_severity
from .rules import scan as rule_scan

try:
    from detector.classifier import classify
except ImportError:

    def classify(text: str) -> dict:
        return {
            "is_injection": False,
            "confidence": 0.0,
            "label": "unavailable",
            "available": False,
        }


RULE_BLOCK_THRESHOLD = 0.90
RULE_SUSPICIOUS_THRESHOLD = 0.70
CLASSIFIER_BLOCK_THRESHOLD = 0.85
CLASSIFIER_SUSPICIOUS_THRESHOLD = 0.60


def detect(text: str, tool_name: str = "", modality: str = "") -> dict:
    """Run the three-layer detection pipeline."""
    content_hash = hashlib.sha256(text.encode()).hexdigest()[:16]
    reasons = []
    details = {}

    rule_matches = rule_scan(text)
    details["rule_matches"] = [
        {
            "id": m.rule_id,
            "name": m.rule_name,
            "category": m.category,
            "severity": m.severity,
            "text": m.matched_text,
        }
        for m in rule_matches
    ]

    if rule_matches:
        severity = max_severity(rule_matches)

        if severity >= RULE_BLOCK_THRESHOLD:
            reasons = [f"Rule match: {m.rule_name} ({m.matched_text[:60]})" for m in rule_matches]
            return _result("block", severity, reasons, text, content_hash, "rules", details)

        if severity >= RULE_SUSPICIOUS_THRESHOLD:
            reasons = [f"Suspicious rule match: {m.rule_name}" for m in rule_matches]

    clf_result = classify(text)
    details["classifier"] = clf_result

    if clf_result["available"]:
        if clf_result["is_injection"] and clf_result["confidence"] >= CLASSIFIER_BLOCK_THRESHOLD:
            reasons.append(f"ML classifier: injection (confidence={clf_result['confidence']:.2f})")
            combined_conf = max(
                clf_result["confidence"],
                max_severity(rule_matches) if rule_matches else 0,
            )
            return _result("block", combined_conf, reasons, text, content_hash, "classifier", details)

        if clf_result["is_injection"] and clf_result["confidence"] >= CLASSIFIER_SUSPICIOUS_THRESHOLD:
            reasons.append(f"ML classifier: suspicious (confidence={clf_result['confidence']:.2f})")

    if reasons or (rule_matches and max_severity(rule_matches) >= 0.5):
        rule_summary = ", ".join(f"{m.rule_name}" for m in rule_matches) if rule_matches else ""
        clf_summary = (
            f"{clf_result['label']}@{clf_result['confidence']:.2f}"
            if clf_result["available"]
            else ""
        )

        judge_result = judge(
            content=text,
            tool_name=tool_name,
            modality=modality,
            rule_matches=rule_summary,
            classifier_result=clf_summary,
        )
        details["judge"] = judge_result

        if judge_result["available"]:
            if judge_result.get("errored"):
                reasons.extend(judge_result["reasons"])
                return _result(
                    "sanitize",
                    judge_result["confidence"],
                    reasons,
                    text,
                    content_hash,
                    "judge",
                    details,
                )
            if judge_result["verdict"] == "injection":
                reasons.extend(judge_result["reasons"])
                return _result(
                    "block",
                    judge_result["confidence"],
                    reasons,
                    text,
                    content_hash,
                    "judge",
                    details,
                )
            if judge_result["verdict"] == "suspicious":
                reasons.extend(judge_result["reasons"])
                return _result(
                    "sanitize",
                    judge_result["confidence"],
                    reasons,
                    text,
                    content_hash,
                    "judge",
                    details,
                )

    if rule_matches and max_severity(rule_matches) >= 0.5:
        reasons = reasons or [f"Low-confidence rule match: {rule_matches[0].rule_name}"]
        return _result(
            "sanitize",
            max_severity(rule_matches),
            reasons,
            text,
            content_hash,
            "rules",
            details,
        )

    return _result(
        "pass",
        0.0,
        [],
        text,
        content_hash,
        "classifier" if clf_result["available"] else "rules",
        details,
    )


def _result(
    verdict: str,
    confidence: float,
    reasons: list[str],
    text: str,
    content_hash: str,
    layer: str,
    details: dict,
) -> dict:
    sanitized = _sanitize(text) if verdict == "sanitize" else None
    return {
        "verdict": verdict,
        "confidence": round(confidence, 3),
        "reasons": reasons,
        "sanitized_content": sanitized,
        "content_hash": content_hash,
        "layer_reached": layer,
        "details": details,
    }


def _sanitize(text: str) -> str:
    sanitized = text

    for char in "\u200b\u200c\u200d\u2060\ufeff\u200e\u200f":
        sanitized = sanitized.replace(char, "")

    sanitized = re.sub(r"<!--.*?-->", "[REMOVED_COMMENT]", sanitized, flags=re.S)
    sanitized = re.sub(
        r"<[^>]*style\s*=\s*[\"'][^\"']*display\s*:\s*none[^\"']*[\"'][^>]*>.*?</[^>]+>",
        "[REMOVED_HIDDEN]",
        sanitized,
        flags=re.S | re.I,
    )

    patterns = [
        (r"ignore\s+(all\s+)?(previous|prior)\s+instructions?", "[DEFANGED_OVERRIDE]"),
        (r"you\s+are\s+now\s+", "[DEFANGED_ROLE]"),
        (r"<\s*/?system\s*>", "[DEFANGED_TAG]"),
    ]
    for pat, replacement in patterns:
        sanitized = re.sub(pat, replacement, sanitized, flags=re.I)

    return sanitized
