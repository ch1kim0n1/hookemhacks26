"""Orchestrates one red→blue learning round."""

from __future__ import annotations

import hashlib

from .blue_agent import BlueAgent
from .publisher import publish_defense_update
from .red_agent import RedAgent
from .rule_extractor import extract_from_variations


class LearningOrchestrator:
    def __init__(self) -> None:
        self.red = RedAgent()
        self.blue = BlueAgent()

    def run_round(self, seed_prompt: str) -> dict:
        proposals = self.red.propose(seed_prompt)
        variants = [p.variant for p in proposals]
        rules = extract_from_variations(variants)
        score = self.blue.forward([0.2, 0.4, 0.1, 0.0, 0.0])
        payload = {"rules": rules, "blue_score": score, "variants": len(variants)}
        derived = hashlib.sha256(seed_prompt.encode()).digest()
        publish_defense_update(derived_from_attack_hash=derived)
        return payload
