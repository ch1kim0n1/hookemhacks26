"""HTTP client for the zk-prover service.

Separates the prover transport from the main loop so the Scenario B
path can mock it cleanly. Raises typed errors for the two outcomes the
defense-agent cares about: policy rule not found (expected for Scenario
B) and prover unavailable (escalate to alerts).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


class ProverError(Exception):
    """Base exception for prover client failures."""


class PolicyRuleNotFoundError(ProverError):
    """Raised on HTTP 422 from /prove/policy — the expected Scenario B
    outcome. The agent must proceed to submit an empty-proof tx so the
    on-chain verifier produces the visible rejection."""


class ProverUnavailableError(ProverError):
    """Raised on HTTP 5xx or transport errors. Operational — emits an
    alert rather than driving the demo flow."""


@dataclass
class ProofResult:
    proof_hex: str
    public_inputs: list[str]
    image_id: str
    elapsed_ms: int
    cached: bool = False


class ProverClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout_s: float = 10.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            timeout=timeout_s,
            transport=transport,
        )

    def prove_policy(self, inputs: dict[str, Any]) -> ProofResult:
        try:
            resp = self._client.post("/prove/policy", json=inputs)
        except httpx.HTTPError as exc:
            raise ProverUnavailableError(str(exc)) from exc

        if resp.status_code == 422:
            raise PolicyRuleNotFoundError(resp.text)
        if resp.status_code >= 500:
            raise ProverUnavailableError(
                f"HTTP {resp.status_code}: {resp.text}"
            )
        resp.raise_for_status()

        data = resp.json()
        return ProofResult(
            proof_hex=data["proof"],
            public_inputs=data["publicInputs"],
            image_id=data["imageId"],
            elapsed_ms=data.get("elapsedMs", 0),
            cached=bool(data.get("cached", False)),
        )
