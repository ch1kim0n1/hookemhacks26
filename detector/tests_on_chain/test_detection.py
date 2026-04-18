"""Detection engine unit tests."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from detector.on_chain.__main__ import ATTACK_SELECTOR, handle_pending


@pytest.mark.asyncio
async def test_publishes_on_attack_selector():
    publisher = MagicMock()
    publisher.publish = AsyncMock()
    addresses = {
        "FlashLoanAttacker": "0xABCDEF0000000000000000000000000000000001",
        "VictimLendingPool": "0xDEADBEEF00000000000000000000000000000002",
    }
    msg = {
        "observedAt": "2026-04-15T00:00:00Z",
        "tx": {
            "hash": "0xdeadbeef",
            "from": "0xaaa0000000000000000000000000000000000001",
            "to": "0xABCDEF0000000000000000000000000000000001",
            "selector": "0x" + ATTACK_SELECTOR,
        },
    }
    await handle_pending(publisher, addresses, msg)
    publisher.publish.assert_awaited_once()
    channel, body = publisher.publish.call_args[0]
    assert channel == "sentinel.detection.confirmed"
    assert body["pattern"] == "FLASH_LOAN_ORACLE_MANIP"
    # Direct exploit call sets confidence to 0.9 → 9000 bp
    assert body["confidence"] >= 8500  # ≥ confirmed_threshold of 0.85
    assert body["victimProtocol"] == addresses["VictimLendingPool"]


@pytest.mark.asyncio
async def test_ignores_other_selectors():
    publisher = MagicMock()
    publisher.publish = AsyncMock()
    addresses = {
        "FlashLoanAttacker": "0xABCDEF0000000000000000000000000000000001",
        "VictimLendingPool": "0xDEADBEEF00000000000000000000000000000002",
    }
    msg = {
        "observedAt": "2026-04-15T00:00:00Z",
        "tx": {
            "hash": "0xdeadbeef",
            "from": "0xaaa0000000000000000000000000000000000001",
            "to": "0xABCDEF0000000000000000000000000000000001",
            "selector": "0xdeadbeef",
        },
    }
    await handle_pending(publisher, addresses, msg)
    publisher.publish.assert_not_awaited()
