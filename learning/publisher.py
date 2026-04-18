"""Package defense updates and submit to `DefenseProtocol` (web3)."""
from __future__ import annotations

import json
import os
from typing import Any

try:
    from eth_account import Account
    from web3 import Web3

    HAS_WEB3 = True
except ImportError:
    HAS_WEB3 = False


def publish_defense_update(
    *,
    rpc_url: str | None = None,
    defense_protocol_address: str | None = None,
    private_key: str | None = None,
    rule_diff_hash: bytes = b"\x00" * 32,
    model_delta_hash: bytes = b"\x00" * 32,
    proof: bytes = b"",
) -> dict[str, Any]:
    """Placeholder calldata builder — wire ABI when contracts deployed."""
    if not HAS_WEB3:
        return {"ok": False, "error": "web3/eth-account not installed"}
    rpc = rpc_url or os.getenv("RPC_URL", "http://127.0.0.1:8545")
    addr = defense_protocol_address or os.getenv("DEFENSE_PROTOCOL_ADDRESS", "")
    key = private_key or os.getenv("CLAWGUARD_PRIVATE_KEY", "")
    if not addr or not key:
        return {"ok": False, "error": "DEFENSE_PROTOCOL_ADDRESS and key required"}
    w3 = Web3(Web3.HTTPProvider(rpc))
    acct = Account.from_key(key)
    _ = (w3, acct, rule_diff_hash, model_delta_hash, proof)
    return {"ok": True, "queued": True, "note": "deploy DefenseProtocol and pass verifyAndExecute ABI"}
