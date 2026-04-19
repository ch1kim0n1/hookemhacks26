"""Compose Gemini judging with optional defense-protocol proposal building.

Not imported by ``pipeline.detect``. Use when wiring a Gemini-first path.
"""

from __future__ import annotations

from typing import Any

from skill.detectors.defense_protocol_proposal import (
    build_defense_protocol_proposal,
    judge_recommends_protocol_refresh,
)
from skill.detectors.gemini_judge import gemini_judge


def gemini_judge_with_protocol_signal(
    content: str,
    tool_name: str = "",
    modality: str = "",
    rule_matches: str = "",
    classifier_result: str = "",
    *,
    content_hash_hex: str,
    old_policy_hash: bytes | None = None,
    zk_proof: bytes = b"",
) -> dict[str, Any]:
    """Run Gemini judge and, if appropriate, build a defense publish payload.

    Does **not** broadcast a transaction or call ``publish_defense_update``.
    """
    judge_result = gemini_judge(
        content,
        tool_name=tool_name,
        modality=modality,
        rule_matches=rule_matches,
        classifier_result=classifier_result,
    )
    out: dict[str, Any] = {"judge": judge_result, "protocol_proposal": None}
    if judge_recommends_protocol_refresh(judge_result):
        out["protocol_proposal"] = build_defense_protocol_proposal(
            content_hash_hex=content_hash_hex,
            judge_result=judge_result,
            old_policy_hash=old_policy_hash,
            zk_proof=zk_proof,
        )
    return out
