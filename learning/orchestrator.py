"""Learning loop orchestrator — coordinates Red/Blue generations."""
from __future__ import annotations

from dataclasses import dataclass

from .blue_agent import MLP
from .red_agent import AttackVariant, EvalResult, RedAgent, RedAgentConfig


@dataclass
class OrchestratorConfig:
    population_size: int = 8
    feature_dim: int = 5


class LearningOrchestrator:
    """Minimal orchestrator: Red proposes variants; Blue MLP scores features (stub features)."""

    def __init__(self, red_cfg: RedAgentConfig, *, feature_dim: int = 5) -> None:
        self.red = RedAgent(red_cfg)
        self.blue = MLP(feature_dim)
        self._feature_dim = feature_dim

    def variant_to_features(self, v: AttackVariant) -> list[float]:
        """Map variant to a fixed-size vector for the MLP (stub)."""
        loan = min(1.0, int(v.loanAmountWei) / 1e21)
        return [
            loan,
            v.priceManipFactor / 10.0,
            float(v.generation % 10) / 10.0,
            0.5,
            0.5,
        ][: self._feature_dim]

    def run_generation(self, survivors: list[AttackVariant] | None = None) -> tuple[list[AttackVariant], list[EvalResult]]:
        variants = self.red.generate_population(8, survivors)
        results: list[EvalResult] = []
        for v in variants:
            x = self.variant_to_features(v)
            p = self.blue.predict(x)
            defended = p >= 0.5
            results.append(EvalResult(variantId=v.id, defended=defended))
        self.red.observe_results(variants, results)
        return variants, results
