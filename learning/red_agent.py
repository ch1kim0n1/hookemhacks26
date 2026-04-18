"""Red agent — attack variant generator; port of SENTINEL `red-agent.ts`."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from .bayesian_opt import BayesianOptimizer


@dataclass
class AttackVariant:
    id: str
    loanAmountWei: str
    priceManipFactor: float
    flashLoanProvider: str
    victimProtocol: str
    generation: int


@dataclass
class EvalResult:
    variantId: str
    defended: bool


@dataclass
class RedAgentConfig:
    baseLoanWei: str
    priceManipRange: tuple[float, float]
    flashLoanProvider: str
    victimProtocol: str
    useBayesian: bool = True


class RedAgent:
    def __init__(self, config: RedAgentConfig) -> None:
        self._config = config
        self._generation = 0
        self._optimizer = BayesianOptimizer()
        self._use_bayesian = config.useBayesian

    def generate_population(self, size: int, survivors: list[AttackVariant] | None = None) -> list[AttackVariant]:
        self._generation += 1
        variants: list[AttackVariant] = []
        base = int(self._config.baseLoanWei)

        if self._use_bayesian and self._generation > 1 and self._optimizer.observation_count >= 3:
            bayes_count = size // 2
            for _ in range(bayes_count):
                variants.append(self._from_optimizer(base))
        elif survivors:
            mutation_count = min(size // 2, len(survivors))
            for i in range(mutation_count):
                variants.append(self._mutate(survivors[i], base))

        while len(variants) < size:
            variants.append(self._random(base))
        return variants

    def observe_results(self, variants: list[AttackVariant], results: list[EvalResult]) -> None:
        if not self._use_bayesian:
            return
        base = int(self._config.baseLoanWei)
        for result in results:
            variant = next((v for v in variants if v.id == result.variantId), None)
            if variant is None:
                continue
            loan_factor = (int(variant.loanAmountWei) * 100 / base / 100) if base > 0 else 1.0
            self._optimizer.observe(loan_factor, variant.priceManipFactor, not result.defended)

    @property
    def current_generation(self) -> int:
        return self._generation

    def _from_optimizer(self, base: int) -> AttackVariant:
        lf, pf = self._optimizer.suggest()
        loan_amount = int(base * lf)
        return AttackVariant(
            id=str(uuid.uuid4()),
            loanAmountWei=str(loan_amount),
            priceManipFactor=round(pf * 100) / 100,
            flashLoanProvider=self._config.flashLoanProvider,
            victimProtocol=self._config.victimProtocol,
            generation=self._generation,
        )

    def _random(self, base: int) -> AttackVariant:
        import random

        r = random.Random()
        factor = 0.5 + r.random() * 1.5
        loan_amount = int(base * factor)
        mn, mx = self._config.priceManipRange
        pf = mn + r.random() * (mx - mn)
        return AttackVariant(
            id=str(uuid.uuid4()),
            loanAmountWei=str(loan_amount),
            priceManipFactor=round(pf * 100) / 100,
            flashLoanProvider=self._config.flashLoanProvider,
            victimProtocol=self._config.victimProtocol,
            generation=self._generation,
        )

    def _mutate(self, parent: AttackVariant, base: int) -> AttackVariant:
        import random

        r = random.Random()
        parent_loan = int(parent.loanAmountWei)
        factor = 0.85 + r.random() * 0.3
        loan_amount = max(1, int(parent_loan * factor))
        pf = parent.priceManipFactor * (0.9 + r.random() * 0.2)
        mn, mx = self._config.priceManipRange
        pf = max(mn, min(mx, pf))
        return AttackVariant(
            id=str(uuid.uuid4()),
            loanAmountWei=str(loan_amount),
            priceManipFactor=round(pf * 100) / 100,
            flashLoanProvider=self._config.flashLoanProvider,
            victimProtocol=self._config.victimProtocol,
            generation=self._generation,
        )
