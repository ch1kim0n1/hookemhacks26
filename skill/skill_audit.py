"""Heuristic audit of OpenClaw-style skill manifests and embedded code for unsafe patterns."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class Finding:
    severity: str  # info | low | medium | high | critical
    code: str
    detail: str


# Code / instruction patterns that often indicate malicious or overly powerful skills
_CODE_PATTERNS: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"\beval\s*\("), "eval_call", "critical"),
    (re.compile(r"\bexec\s*\("), "exec_call", "critical"),
    (re.compile(r"\b__import__\s*\("), "dynamic_import", "high"),
    (re.compile(r"compile\s*\([^)]*exec"), "compile_exec", "critical"),
    (re.compile(r"os\.system\s*\("), "os_system", "critical"),
    (re.compile(r"subprocess\."), "subprocess", "high"),
    (re.compile(r"pty\.spawn\s*\("), "pty_spawn", "critical"),
    (re.compile(r"socket\.socket\s*\("), "raw_socket", "high"),
    (re.compile(r"urllib\.request\.urlopen\s*\("), "urllib_open", "medium"),
    (re.compile(r"requests\.(get|post|put|delete)\s*\("), "http_client", "medium"),
    (re.compile(r"pickle\.loads?\s*\("), "pickle", "critical"),
    (re.compile(r"yaml\.load\s*\("), "yaml_unsafe_load", "high"),
    (re.compile(r"chmod\s*\(\s*0o\d+"), "dangerous_chmod", "medium"),
]

# Suspicious manifest / hook declarations
_MANIFEST_PATTERNS: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"hook[s]?\s*:\s*[^\n]*shell_exec", re.I), "shell_hook", "critical"),
    (re.compile(r"permission[s]?\s*:\s*[^\n]*all", re.I), "wildcard_permissions", "high"),
    (re.compile(r"requires_env\s*:\s*\[\s*\]", re.M), "empty_env_block", "info"),
]


def audit_skill_manifest(markdown: str) -> dict:
    """Return structured risk assessment for a SKILL.md (frontmatter + body).

    This does not prove absence of malware; it flags common red flags before a skill is loaded.
    """
    findings: list[Finding] = []

    for pat, code, sev in _MANIFEST_PATTERNS:
        if pat.search(markdown):
            findings.append(
                Finding(sev, code, "Pattern matched in manifest / frontmatter region.")
            )

    # fenced code blocks (```python, ```py, ```)
    fence_re = re.compile(r"```(?:python|py|sh|bash|zsh)?\s*\n(.*?)```", re.S | re.I)
    for block in fence_re.findall(markdown):
        findings.extend(_scan_code_block(block))

    # remainder of document (inline backticks, prose)
    stripped = fence_re.sub("", markdown)
    findings.extend(_scan_code_block(stripped, loose=True))

    score = _score(findings)
    verdict = _verdict(score, findings)

    return {
        "verdict": verdict,
        "risk_score": round(score, 3),
        "findings": [
            {"severity": f.severity, "code": f.code, "detail": f.detail} for f in findings
        ],
        "summary": _summary(verdict, findings),
    }


def _scan_code_block(block: str, loose: bool = False) -> list[Finding]:
    out: list[Finding] = []
    for pat, code, sev in _CODE_PATTERNS:
        if pat.search(block):
            if loose and sev in ("medium", "info"):
                continue
            out.append(Finding(sev, code, "Matched in skill text or code block."))
    return out


def _score(findings: list[Finding]) -> float:
    weights = {"info": 0.02, "low": 0.08, "medium": 0.18, "high": 0.35, "critical": 0.55}
    total = 0.0
    seen: set[tuple[str, str]] = set()
    for f in findings:
        key = (f.code, f.severity)
        if key in seen:
            continue
        seen.add(key)
        total += weights.get(f.severity, 0.1)
    return min(1.0, total)


def _verdict(score: float, findings: list[Finding]) -> str:
    if any(f.severity == "critical" for f in findings):
        return "dangerous"
    if score >= 0.45 or any(f.severity == "high" for f in findings):
        return "suspicious"
    if score >= 0.15 or findings:
        return "caution"
    return "safe"


def _summary(verdict: str, findings: list[Finding]) -> str:
    if not findings:
        return "No common high-risk patterns detected in manifest text."
    n = len(findings)
    return f"{verdict.upper()}: {n} signal(s). Review fenced code and hooks before loading."
