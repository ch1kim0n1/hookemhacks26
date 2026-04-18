"""Ensure the OpenClaw skill handler wires to the on-chain registry client."""

from __future__ import annotations

import pytest

from skill.chain.client import ChainClient


@pytest.fixture(autouse=True)
def reset_chain_client(monkeypatch: pytest.MonkeyPatch) -> None:
    import skill.handler as handler

    handler._chain_client = None
    monkeypatch.setattr(ChainClient, "start_polling", lambda self, interval=60: None)
    yield
    handler._chain_client = None


def test_get_chain_client_returns_registry_client() -> None:
    import skill.handler as handler

    client = handler.get_chain_client()
    assert isinstance(client, ChainClient)
