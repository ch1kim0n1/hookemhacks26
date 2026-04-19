"""Poll on-chain threat feed (`getAttacksSince`) and cache locally."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

from skill.config.secrets import get_secret

logger = logging.getLogger(__name__)

try:
    from web3 import Web3

    HAS_WEB3 = True
except ImportError:
    HAS_WEB3 = False


def load_addresses() -> dict[str, Any]:
    p = Path(
        os.getenv("ADDRESSES_FILE")
        or Path(__file__).resolve().parents[1] / "config" / "addresses.local.json"
    )
    return json.loads(p.read_text())


async def poll_attacks_loop(
    *,
    registry_address: str | None = None,
    from_index: int = 0,
    interval_s: float = 10.0,
) -> None:
    """Poll new attacks — replace with Redis fan-out in production."""
    if not HAS_WEB3:
        return
    rpc = get_secret("BASE_SEPOLIA_RPC_URL", default="http://127.0.0.1:8545")
    addr = registry_address or os.getenv("CLAWGUARD_REGISTRY_ADDRESS", "")
    if not addr:
        return
    w3 = Web3(Web3.HTTPProvider(rpc))
    abi = [
        {
            "inputs": [{"name": "fromIndex", "type": "uint256"}],
            "name": "getAttacksSince",
            "outputs": [
                {
                    "components": [
                        {"name": "patternHash", "type": "bytes32"},
                        {"name": "category", "type": "string"},
                        {"name": "sampleRedacted", "type": "string"},
                        {"name": "reporter", "type": "address"},
                        {"name": "timestamp", "type": "uint256"},
                        {"name": "blockNumber", "type": "uint256"},
                    ],
                    "name": "",
                    "type": "tuple[]",
                }
            ],
            "stateMutability": "view",
            "type": "function",
        }
    ]
    c = w3.eth.contract(address=Web3.to_checksum_address(addr), abi=abi)
    last = from_index
    while True:
        attacks = None
        for attempt in range(3):
            try:
                attacks = c.functions.getAttacksSince(last).call()
                break
            except Exception as exc:
                wait = 2**attempt
                logger.warning(
                    "getAttacksSince failed (attempt %s/3): %s; retry in %ss",
                    attempt + 1,
                    exc,
                    wait,
                )
                if attempt == 2:
                    logger.error("getAttacksSince aborted after retries: %s", exc)
                else:
                    await asyncio.sleep(wait)
        if attacks is not None:
            for _a in attacks:
                last += 1
        try:
            from blockchain.async_client import call_rpc

            await call_rpc("eth_blockNumber", rpc, timeout=5.0)
        except Exception:
            logger.debug("eth_blockNumber probe failed", exc_info=True)
        await asyncio.sleep(interval_s)


class NetworkPoller:
    """Thin wrapper so network layer can be tested independently."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def poll(self, count: int = 20) -> list[dict]:
        if hasattr(self._client, "poll_recent"):
            return self._client.poll_recent(count)
        return []
