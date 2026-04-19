"""ClawGuard skill handler — intercepts tool calls and runs the security pipeline."""

import hashlib
import json
import logging
import threading

from . import db
from .chain import ChainClient
from .detectors import detect
from .extractors import extract_all
from .reason_codes import enrich_verdict
from .threat_identity import content_sha256_hex

logger = logging.getLogger(__name__)

BLOCK_AGENT_MESSAGE = (
    "[ClawGuard: BLOCKED. Prompt injection or policy violation detected. "
    "Original task continues without this source.]"
)
SANITIZE_ANNOTATION = (
    "[ClawGuard: SANITIZED — suspicious segments were removed per policy. "
    "Review assistant output before acting.]\n"
)


def _attest_scan_async(content_hash: str, verdict: dict, modality: str) -> None:
    """Fire-and-forget ZK scan attestation for non-pass verdicts.

    Runs in a background thread so proof generation never delays a BLOCK
    response to the agent. Stored in the detections table under `zk_proof`.
    """
    try:
        from zk.prover import prove_scan
    except ImportError:
        return

    def _work() -> None:
        try:
            pattern = "unknown"
            rule_matches = verdict.get("details", {}).get("rule_matches", [])
            if rule_matches:
                pattern = rule_matches[0].get("category", "unknown")
            out = prove_scan(
                {
                    "evidence": {
                        "pattern": pattern,
                        "confidence": int(float(verdict.get("confidence", 0)) * 10_000),
                        "contentHashHex": hashlib.sha256(content_hash.encode()).hexdigest(),
                    },
                    "policyHashHex": hashlib.sha256(b"clawguard-policy-v0").hexdigest(),
                    "eventIdHex": hashlib.sha256(f"{content_hash}:{modality}".encode()).hexdigest(),
                }
            )
            try:
                db.record_scan_attestation(
                    content_hash=content_hash,
                    proof=out.get("proof", ""),
                    image_id=out.get("imageId", ""),
                    mock=bool(out.get("_mock")),
                )
            except Exception:
                pass
        except Exception as exc:
            logger.debug("scan_attestation_failed: %s", exc)

    threading.Thread(target=_work, name="zk-scan-attest", daemon=True).start()


def _audit_tool_intercept(
    tool_name: str, modality: str, content_hash: str, verdict: dict
) -> None:
    """Structured audit row for every hook invocation (issue #108)."""
    enrich_verdict(verdict)
    detail = {
        "tool": tool_name,
        "modality": modality,
        "content_hash": content_hash,
        "verdict": verdict.get("verdict"),
        "confidence": verdict.get("confidence"),
        "layer": verdict.get("layer_reached"),
        "reason_codes": verdict.get("reason_codes"),
        "reason_family": verdict.get("reason_family"),
    }
    db.audit_log(
        action="tool_intercept",
        resource=f"content_hash:{content_hash[:24]}",
        detail=json.dumps(detail, default=str)[:4000],
        result="success",
    )


def _audit_non_pass(
    tool_name: str, modality: str, content_hash: str, verdict: dict
) -> None:
    v = verdict.get("verdict")
    if v == "pass":
        return
    action = "attack_blocked" if v == "block" else "attack_sanitized"
    db.audit_log(
        action=action,
        resource=f"content_hash:{content_hash}",
        detail=f"verdict={v}, modality={modality}, tool={tool_name}",
        result="success",
    )


class ContentBlocked(Exception):
    """Raised when content is blocked by ClawGuard."""
    def __init__(self, verdict: dict):
        self.verdict = verdict
        super().__init__(f"Content blocked: {', '.join(verdict['reasons'])}")


# Global chain client — initialized lazily
_chain_client = None


def get_chain_client() -> ChainClient:
    global _chain_client
    if _chain_client is None:
        _chain_client = ChainClient()
        _chain_client.start_polling(interval=60)
    return _chain_client


def intercept(tool_name: str, content: str | bytes,
              content_type: str | None = None,
              filename: str | None = None,
              enabled: bool = True) -> dict:
    """Main entry point — called by OpenClaw pre-tool hooks.

    Args:
        tool_name: which tool triggered this (email_read, web_fetch, etc.)
        content: raw content from the tool
        content_type: MIME type if known
        filename: filename if applicable
        enabled: set False to bypass (for demo toggle)

    Returns:
        {
            "action": "pass" | "sanitize" | "block",
            "content": str,  # original or sanitized
            "verdict": dict,  # full detection result
            "extraction": dict,  # what was extracted
        }

    Raises:
        ContentBlocked: if content is blocked and enabled=True
    """
    if not enabled:
        v = {"verdict": "bypass", "confidence": 0, "reasons": ["ClawGuard disabled"]}
        enrich_verdict(v)
        _audit_tool_intercept(tool_name, "bypass", "disabled", v)
        return {
            "action": "pass",
            "content": content if isinstance(content, str) else content.decode("utf-8", errors="replace"),
            "verdict": v,
            "extraction": {"modality": "bypass", "text": "", "manifest": []},
        }

    # Step 1: Extract text from all modalities
    extraction = extract_all(content, content_type, filename)
    text = extraction["text"]

    if not text.strip():
        v = {"verdict": "pass", "confidence": 0, "reasons": ["no text extracted"]}
        enrich_verdict(v)
        _audit_tool_intercept(tool_name, extraction["modality"], "empty", v)
        return {
            "action": "pass",
            "content": content if isinstance(content, str) else content.decode("utf-8", errors="replace"),
            "verdict": v,
            "extraction": extraction,
        }

    # Step 2: Quick hash check against on-chain threat cache (canonical SHA-256 hex)
    content_hash = content_sha256_hex(text)
    chain = get_chain_client()
    cached_threat = chain.check_hash(content_hash)

    if cached_threat:
        verdict = {
            "verdict": "block",
            "confidence": 1.0,
            "reasons": [f"Known threat (cached): {cached_threat['category']}"],
            "content_hash": content_hash,
            "layer_reached": "cache",
            "sanitized_content": None,
            "details": {"cached_threat": cached_threat},
        }
        enrich_verdict(verdict)
        verdict["agent_message"] = BLOCK_AGENT_MESSAGE
        _audit_tool_intercept(tool_name, extraction["modality"], content_hash, verdict)
        _audit_non_pass(tool_name, extraction["modality"], content_hash, verdict)
        db.log_detection(tool_name, extraction["modality"], "block", 1.0,
                         verdict["reasons"], content_hash, text[:200],
                         extraction.get("manifest"))
        raise ContentBlocked(verdict)

    # Step 3: Run detection pipeline
    verdict = detect(text, tool_name=tool_name, modality=extraction["modality"])
    verdict["content_hash"] = content_hash
    enrich_verdict(verdict)

    # Step 4: Log and act
    db.log_detection(
        tool_name=tool_name,
        modality=extraction["modality"],
        verdict=verdict["verdict"],
        confidence=verdict["confidence"],
        reasons=verdict["reasons"],
        content_hash=content_hash,
        content_preview=text[:200],
        source_manifest=extraction.get("manifest"),
    )
    if verdict["verdict"] != "pass":
        _audit_non_pass(tool_name, extraction["modality"], content_hash, verdict)

    if verdict["verdict"] == "block":
        # Publish to chain
        if verdict["reasons"]:
            category = _categorize(verdict)
            sample = _redact(text[:200])
            chain.publish_attack(content_hash, category, sample)

        # Fire-and-forget ZK attestation — must not delay agent response.
        _attest_scan_async(content_hash, verdict, extraction["modality"])

        verdict["agent_message"] = BLOCK_AGENT_MESSAGE
        _audit_tool_intercept(tool_name, extraction["modality"], content_hash, verdict)
        raise ContentBlocked(verdict)

    if verdict["verdict"] == "sanitize":
        _audit_tool_intercept(tool_name, extraction["modality"], content_hash, verdict)
        return {
            "action": "sanitize",
            "content": SANITIZE_ANNOTATION + (verdict["sanitized_content"] or text),
            "verdict": verdict,
            "extraction": extraction,
        }

    _audit_tool_intercept(tool_name, extraction["modality"], content_hash, verdict)
    return {
        "action": "pass",
        "content": content if isinstance(content, str) else content.decode("utf-8", errors="replace"),
        "verdict": verdict,
        "extraction": extraction,
    }


def scan_only(content: str | bytes, content_type: str | None = None,
              filename: str | None = None, tool_name: str = "manual") -> dict:
    """Scan content without blocking — for the API/dashboard.

    Returns full result dict without raising exceptions.
    """
    extraction = extract_all(content, content_type, filename)
    text = extraction["text"]

    if not text.strip():
        return {
            "action": "pass",
            "content": content if isinstance(content, str) else content.decode("utf-8", errors="replace"),
            "verdict": {"verdict": "pass", "confidence": 0, "reasons": ["no text extracted"]},
            "extraction": extraction,
        }

    content_hash = content_sha256_hex(text)

    # Check cache
    chain = get_chain_client()
    cached = chain.check_hash(content_hash)
    if cached:
        verdict = {
            "verdict": "block",
            "confidence": 1.0,
            "reasons": [f"Known threat: {cached['category']}"],
            "content_hash": content_hash,
            "layer_reached": "cache",
            "sanitized_content": None,
            "details": {"cached_threat": cached},
        }
    else:
        verdict = detect(text, tool_name=tool_name, modality=extraction["modality"])
        verdict["content_hash"] = content_hash
    enrich_verdict(verdict)

    if verdict["verdict"] != "pass":
        _audit_non_pass(tool_name, extraction["modality"], content_hash, verdict)
    db.log_detection(tool_name, extraction["modality"], verdict["verdict"],
                     verdict["confidence"], verdict["reasons"],
                     content_hash, text[:200], extraction.get("manifest"))

    out_content = verdict.get("sanitized_content") or (
        content if isinstance(content, str) else content.decode("utf-8", errors="replace")
    )
    if verdict["verdict"] == "sanitize":
        out_content = SANITIZE_ANNOTATION + (verdict.get("sanitized_content") or text)

    return {
        "action": verdict["verdict"],
        "content": out_content,
        "verdict": verdict,
        "extraction": extraction,
    }


def _categorize(verdict: dict) -> str:
    """Extract a category from the detection result."""
    details = verdict.get("details", {})
    rule_matches = details.get("rule_matches", [])
    if rule_matches:
        return rule_matches[0].get("category", "unknown")
    return "prompt_injection"


def _redact(text: str) -> str:
    """Basic redaction — remove emails, phone numbers."""
    import re
    text = re.sub(r'[\w.-]+@[\w.-]+\.\w+', '[EMAIL]', text)
    text = re.sub(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b', '[PHONE]', text)
    return text
