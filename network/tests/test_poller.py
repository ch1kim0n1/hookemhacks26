"""Smoke tests for network.poller — degraded-mode only (no RPC)."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from network import poller


def test_load_addresses_reads_pointed_file(tmp_path: Path, monkeypatch):
    data = {"ThreatRegistry": "0xabc", "DefenseProtocol": "0xdef"}
    f = tmp_path / "addresses.json"
    f.write_text(json.dumps(data))
    monkeypatch.setenv("ADDRESSES_FILE", str(f))
    assert poller.load_addresses() == data


def test_poll_attacks_loop_returns_without_registry_address(monkeypatch):
    # No env vars set => poller short-circuits; with HAS_WEB3 possibly
    # False on slim builds, the function returns immediately.
    monkeypatch.delenv("CLAWGUARD_REGISTRY_ADDRESS", raising=False)

    async def run():
        # from_index kept at 0; no interval sleeps reached because registry
        # is missing.
        await asyncio.wait_for(
            poller.poll_attacks_loop(registry_address="", interval_s=0.01),
            timeout=1.0,
        )

    asyncio.run(run())
