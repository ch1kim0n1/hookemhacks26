"""Red agent: proposes adversarial prompt variants (Bayesian GP placeholder)."""

from dataclasses import dataclass


@dataclass
class RedProposal:
    variant: str
    score: float


class RedAgent:
    """Surrogate for Bayesian GP attack search."""

    def propose(self, seed: str, n: int = 1) -> list[RedProposal]:
        if not seed.strip():
            return []
        return [RedProposal(variant=seed[:500], score=0.0) for _ in range(max(1, n))]
