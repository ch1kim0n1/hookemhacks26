"""Tests for prover_client. Mocks the HTTP layer."""

from __future__ import annotations

import httpx
import pytest

from defense_agent.prover_client import (
    PolicyRuleNotFoundError,
    ProverClient,
    ProverUnavailableError,
)


class _MockTransport(httpx.BaseTransport):
    def __init__(self, status_code: int, body: dict):
        self.status_code = status_code
        self.body = body

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        return httpx.Response(self.status_code, json=self.body, request=request)


def _client(status: int, body: dict) -> ProverClient:
    return ProverClient(
        base_url="http://prover.test",
        transport=_MockTransport(status, body),
    )


def test_prove_policy_returns_proof_and_public_inputs() -> None:
    client = _client(
        200,
        {
            "proof": "0xdeadbeef",
            "publicInputs": ["0x01", "0x02", "0x03"],
            "imageId": "0xabc",
            "elapsedMs": 42,
        },
    )
    result = client.prove_policy({"any": "input"})
    assert result.proof_hex == "0xdeadbeef"
    assert result.public_inputs == ["0x01", "0x02", "0x03"]
    assert result.image_id == "0xabc"
    assert result.elapsed_ms == 42


def test_prove_policy_422_raises_policy_rule_not_found() -> None:
    client = _client(422, {"error": "POLICY_RULE_NOT_FOUND"})
    with pytest.raises(PolicyRuleNotFoundError):
        client.prove_policy({"any": "input"})


def test_prove_policy_5xx_raises_unavailable() -> None:
    client = _client(503, {"error": "prover down"})
    with pytest.raises(ProverUnavailableError):
        client.prove_policy({"any": "input"})


def test_prove_policy_cached_flag_propagates() -> None:
    client = _client(
        200,
        {
            "proof": "0xaabb",
            "publicInputs": [],
            "imageId": "0x0",
            "elapsedMs": 1,
            "cached": True,
        },
    )
    result = client.prove_policy({})
    assert result.cached is True
