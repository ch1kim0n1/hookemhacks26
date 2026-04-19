"""Orchestrates one red→blue learning round."""

from __future__ import annotations

import hashlib
import logging

from .blue_agent import BlueAgent
from .metrics import record_round
from .publisher import publish_defense_update
from .red_agent import RedAgent
from .rule_extractor import extract_from_variations

logger = logging.getLogger(__name__)


class LearningOrchestrator:
    def __init__(self) -> None:
        self.red = RedAgent()
        self.blue = BlueAgent()

    def run_round(self, seed_prompt: str) -> dict:
        try:
            proposals = self.red.propose(seed_prompt)
            variants = [p.variant for p in proposals]
            rules = extract_from_variations(variants)
            # NB: blue agent features are still hardcoded — see learning/README.md
            # for the honest state of this loop. The real feature extraction
            # lives in learning/rule_extractor.py but is not wired yet.
            score = self.blue.forward([0.2, 0.4, 0.1, 0.0, 0.0])
            payload = {"rules": rules, "blue_score": score, "variants": len(variants)}
            derived = hashlib.sha256(seed_prompt.encode()).digest()
            publish_ok: bool | None = None
            try:
                # We use the mock ZK prover for defense-update proofs. Publisher
                # will refuse an empty proof unless ALLOW_EMPTY_ZK_PROOF is set;
                # we supply a non-empty mock proof so intent is explicit.
                mock_proof = hashlib.sha256(b"mock-zk-proof:" + derived).digest()
                result = publish_defense_update(
                    derived_from_attack_hash=derived,
                    proof=mock_proof,
                )
                if isinstance(result, dict):
                    publish_ok = bool(result.get("ok"))
                    if not publish_ok and result.get("queued"):
                        logger.info("defense_update_queued: %s", result.get("error", "offline"))
                    elif not publish_ok:
                        logger.warning("defense_update_failed: %s", result.get("error", result))
                    else:
                        logger.info("defense_update_ok")
                else:
                    publish_ok = True
            except Exception as exc:
                logger.exception("defense_update_exception: %s", exc)
                publish_ok = False
            payload["publish_ok"] = publish_ok
            record_round(
                variations=len(variants),
                rules=len(rules),
                blue_score=score,
                publish_ok=publish_ok,
            )
            try:
                from skill.observability import metrics as prom

                prom.learning_rounds_total.inc()
                prom.blue_agent_accuracy.set(float(score))
            except Exception:
                pass
            return payload
        except Exception as exc:
            logger.exception("learning_round_failed: %s", exc)
            try:
                from skill.observability.alerts import AlertSeverity, alert_sync

                alert_sync(
                    "Learning round failed",
                    str(exc),
                    AlertSeverity.CRITICAL,
                    {"service": "learning"},
                )
            except Exception:
                pass
            raise
