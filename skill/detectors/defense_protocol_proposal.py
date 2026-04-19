"""Map LLM judge output to ``DefenseProtocol`` publish payload fields.

**Not used** by ``pipeline.detect`` or the learning orchestrator yet — import
when wiring Gemini (or any judge) to on-chain defense updates.

Uses :func:`learning.publisher.build_publish_payload` for canonical encoding.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from learning.publisher import build_publish_payload


def _hex_to_bytes32(value: str) -> bytes:
    h = value.lower().removeprefix("0x").strip()
    if len(h) != 64 or any(c not in "0123456789abcdef" for c in h):
        raise ValueError("content_hash_hex must be 64 hex characters (sha256)")
    return bytes.fromhex(h)


def judge_recommends_protocol_refresh(judge_result: dict[str, Any]) -> bool:
    """Return True if a defense-protocol refresh should be prepared."""
    if not judge_result.get("available") or judge_result.get("errored"):
        return False
    verdict = judge_result.get("verdict")
    return (
        verdict == "injection"
        or bool(judge_result.get("should_update_protocol"))
        or (verdict == "suspicious" and float(judge_result.get("confidence") or 0) >= 0.75)
    )


def _canonical_judge_fingerprint(judge_result: dict[str, Any]) -> bytes:
    """Stable blob for hashing into policy / rule diff fields."""
    payload = {
        "verdict": judge_result.get("verdict"),
        "confidence": judge_result.get("confidence"),
        "reasons": judge_result.get("reasons") or [],
        "rule_suggestion": judge_result.get("rule_suggestion"),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def build_defense_protocol_proposal(
    *,
    content_hash_hex: str,
    judge_result: dict[str, Any],
    old_policy_hash: bytes | None = None,
    zk_proof: bytes = b"",
) -> dict[str, Any]:
    """Build ``publishDefenseUpdate`` arguments without submitting a tx.

    Returns:
        ``publish_payload``: dict accepted by ``DefenseProtocol.publishDefenseUpdate``
        (via :func:`learning.publisher.publish_defense_update`),
        plus hex-encoded mirrors for dashboards / logs.
    """
    derived_from_attack_hash = _hex_to_bytes32(content_hash_hex)
    old = old_policy_hash if old_policy_hash is not None else b"\x00" * 32
    old = old if len(old) == 32 else old.rjust(32, b"\x00")[:32]

    fp = _canonical_judge_fingerprint(judge_result)
    new_material = derived_from_attack_hash + fp
    new_policy_hash = hashlib.sha256(old + new_material).digest()

    rule_hint = judge_result.get("rule_suggestion")
    if isinstance(rule_hint, str) and rule_hint.strip():
        rule_diff_hash = hashlib.sha256(rule_hint.encode("utf-8")).digest()
    else:
        rule_diff_hash = hashlib.sha256(b"rule:" + fp).digest()

    model_delta_hash = hashlib.sha256(b"model_delta:" + fp).digest()

    publish_payload = build_publish_payload(
        rule_diff_hash=rule_diff_hash,
        model_delta_hash=model_delta_hash,
        derived_from_attack_hash=derived_from_attack_hash,
        zk_proof=zk_proof,
        old_policy_hash=old,
        new_policy_hash=new_policy_hash,
    )

    def _b32(b: bytes) -> str:
        return "0x" + b.hex()

    return {
        "publish_payload": publish_payload,
        "hex": {
            "updateId": _b32(publish_payload["updateId"]),
            "ruleDiffHash": _b32(publish_payload["ruleDiffHash"]),
            "modelDeltaHash": _b32(publish_payload["modelDeltaHash"]),
            "derivedFromAttackHash": _b32(publish_payload["derivedFromAttackHash"]),
            "zkProof": _b32(publish_payload["zkProof"]),
            "publicInputs": [_b32(x) for x in publish_payload["publicInputs"]],
        },
        "recommended_runtime_verdict": (
            "block"
            if judge_result.get("verdict") == "injection"
            else ("sanitize" if judge_result.get("verdict") == "suspicious" else "pass")
        ),
    }
