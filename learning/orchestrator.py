"""Orchestrates one red→blue learning round."""

from __future__ import annotations

import hashlib
import logging

from .blue_agent import BlueAgent
from .features import attack_feature_vector
from .metrics import record_round
from .publisher import publish_defense_update
from .red_agent import RedAgent
from .rule_extractor import extract_from_variations, suggest_rules_from_variations

logger = logging.getLogger(__name__)


def _generate_defense_proof(
    *,
    old_policy_hash: bytes,
    new_policy_hash: bytes,
    derived_from_attack_hash: bytes,
    model_delta_hash: bytes,
    variant_count: int,
) -> tuple[bytes, list[bytes]] | None:
    """Return `(proof_bytes, public_inputs)` or None if ZK layer unavailable.

    Uses zk.prover which falls back to a mock deterministically when the
    Rust prover binary isn't built. Errors are logged but never raised —
    the learning round should still publish with a fallback proof if ZK
    fails, gated by ALLOW_EMPTY_ZK_PROOF at the publisher boundary.
    """
    try:
        from zk.prover import prove_defense_update
    except ImportError:
        return None
    try:
        result = prove_defense_update(
            {
                "oldPolicyHashHex": old_policy_hash.hex(),
                "newPolicyHashHex": new_policy_hash.hex(),
                "derivedFromAttackHashHex": derived_from_attack_hash.hex(),
                "modelDeltaHashHex": model_delta_hash.hex(),
                "variantCount": variant_count,
            }
        )
        proof_hex = result.get("proof", "")
        if proof_hex.startswith("0x"):
            proof_hex = proof_hex[2:]
        proof_bytes = bytes.fromhex(proof_hex) if proof_hex else b""
        public_inputs = []
        for s in result.get("publicInputs", []):
            s = s[2:] if s.startswith("0x") else s
            try:
                public_inputs.append(bytes.fromhex(s).rjust(32, b"\x00")[-32:])
            except ValueError:
                public_inputs.append(hashlib.sha256(s.encode()).digest())
        return proof_bytes, public_inputs
    except Exception as exc:
        logger.warning("defense_update proof generation failed: %s", exc)
        return None


class LearningOrchestrator:
    def __init__(self) -> None:
        self.red = RedAgent()
        self.blue = BlueAgent()

    def run_round(self, seed_prompt: str) -> dict:
        try:
            proposals = self.red.propose(seed_prompt, n=8)
            variants = [p.variant for p in proposals]
            rules = list(
                dict.fromkeys(extract_from_variations(variants) + suggest_rules_from_variations(variants))
            )
            feats = attack_feature_vector(seed_prompt, variants)
            score = self.blue.forward(feats)
            payload = {"rules": rules, "blue_score": score, "variants": len(variants)}
            derived = hashlib.sha256(seed_prompt.encode()).digest()
            # Derive hashes that feed the ZK circuit — small, stable, demo-safe.
            rules_blob = hashlib.sha256(("\n".join(rules)).encode()).digest()
            model_delta = hashlib.sha256(f"score={score:.6f}|n={len(variants)}".encode()).digest()
            old_policy = hashlib.sha256(b"clawguard-policy-v0").digest()
            new_policy = hashlib.sha256(rules_blob + model_delta).digest()

            proof_result = _generate_defense_proof(
                old_policy_hash=old_policy,
                new_policy_hash=new_policy,
                derived_from_attack_hash=derived,
                model_delta_hash=model_delta,
                variant_count=len(variants),
            )
            if proof_result is not None:
                proof_bytes, _public_inputs = proof_result
                payload["zk_mode"] = "real"
            else:
                # Last-resort fallback (publisher will still refuse unless
                # ALLOW_EMPTY_ZK_PROOF is set, so intent stays explicit).
                proof_bytes = hashlib.sha256(b"mock-zk-proof:" + derived).digest()
                payload["zk_mode"] = "fallback"

            publish_ok: bool | None = None
            try:
                result = publish_defense_update(
                    rule_diff_hash=rules_blob,
                    model_delta_hash=model_delta,
                    derived_from_attack_hash=derived,
                    old_policy_hash=old_policy,
                    new_policy_hash=new_policy,
                    proof=proof_bytes,
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
