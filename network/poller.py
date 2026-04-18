"""Poll `ThreatRegistry.getAttacksSince` / `DefenseProtocol` events."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

try:
    from web3 import Web3

    HAS_WEB3 = True
except ImportError:
    HAS_WEB3 = False


def load_addresses() -> dict[str, Any]:
    p = Path(os.getenv("ADDRESSES_FILE") or Path(__file__).resolve().parents[1] / "config" / "addresses.local.json")
    return json.loads(p.read_text())


async def poll_attacks_loop(
    *,
    registry_address: str | None = None,
    from_index: int = 0,
    interval_s: float = 10.0,
) -> None:
    """Print new attacks — replace with Redis fan-out in production."""
    if not HAS_WEB3:
        return
    rpc = os.getenv("BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:8545")
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
        attacks = c.functions.getAttacksSince(last).call()
        for _a in attacks:
            last += 1
        await asyncio.sleep(interval_s)
