"""Minimal on-chain client for `ModelRegistry.sol`.

Each detection-operator calls `register_if_possible()` once on warm-up.
The call is best-effort: if the RPC is unreachable, if the registry
address is missing, or if the private key isn't provisioned, we log and
continue. The federation still works — the on-chain record is an audit
trail, not a hard requirement for detection to function.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Optional

import structlog

log = structlog.get_logger()


@dataclass
class RegistrationResult:
    status: str       # "registered" | "already" | "skipped" | "error"
    tx_hash: str = ""
    model_hash: str = ""
    detail: str = ""


def _load_addresses() -> dict:
    path = os.environ.get("ADDRESSES_FILE")
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def register_if_possible(
    *,
    operator_id: str,
    model_hash: str,
    seed: int,
    rpc_url: Optional[str] = None,
    registry_addr: Optional[str] = None,
    private_key: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> RegistrationResult:
    """Best-effort on-chain registration.

    Never raises. Returns a `RegistrationResult` telling the caller what
    happened so the log line is informative during pitches.
    """
    rpc_url = rpc_url or os.environ.get("RPC_URL", "")
    registry_addr = registry_addr or _load_addresses().get("ModelRegistry", "")
    private_key = private_key or os.environ.get("OPERATOR_PRIVATE_KEY", "")

    # Normalise 0x-prefix on model_hash.
    if not model_hash.startswith("0x"):
        model_hash = "0x" + model_hash
    if len(model_hash) != 66:
        # Truncate/pad to bytes32 if the caller supplied a longer digest.
        raw = model_hash[2:]
        if len(raw) > 64:
            raw = raw[:64]
        else:
            raw = raw.ljust(64, "0")
        model_hash = "0x" + raw

    if not rpc_url or not registry_addr or not private_key:
        return RegistrationResult(
            status="skipped",
            model_hash=model_hash,
            detail="rpc/registry/key missing — running off-chain",
        )

    try:
        from web3 import Web3  # type: ignore
    except ImportError:
        return RegistrationResult(
            status="skipped",
            model_hash=model_hash,
            detail="web3 not installed — running off-chain",
        )

    try:
        w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 3}))
        if not w3.is_connected():
            return RegistrationResult(status="skipped", model_hash=model_hash,
                                      detail=f"rpc unreachable: {rpc_url}")

        account = w3.eth.account.from_key(private_key)
        abi = _MODEL_REGISTRY_ABI
        registry = w3.eth.contract(address=Web3.to_checksum_address(registry_addr), abi=abi)

        # If already registered with this hash, skip.
        try:
            current = registry.functions.modelOf(account.address).call()
            if current and current[0].hex() == model_hash[2:].lower():
                return RegistrationResult(
                    status="already", model_hash=model_hash,
                    detail="identical hash already on-chain",
                )
        except Exception:
            # Older contract / not yet registered — fall through.
            pass

        metadata_bytes = json.dumps(metadata or {
            "operatorId": operator_id, "seed": seed,
        }).encode()

        tx = registry.functions.registerModel(
            operator_id,
            bytes.fromhex(model_hash[2:]),
            metadata_bytes,
        ).build_transaction({
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address),
            "gas": 300_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed = account.sign_transaction(tx)
        raw = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction", None)
        tx_hash = w3.eth.send_raw_transaction(raw)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=5)

        return RegistrationResult(
            status="registered" if receipt.status == 1 else "error",
            tx_hash=tx_hash.hex(),
            model_hash=model_hash,
            detail=f"block {receipt.blockNumber}",
        )
    except Exception as exc:
        return RegistrationResult(
            status="error", model_hash=model_hash,
            detail=f"{type(exc).__name__}: {exc}",
        )


# Hand-authored ABI — avoids a build dependency on forge.
_MODEL_REGISTRY_ABI = [
    {
        "type": "function", "name": "registerModel", "stateMutability": "nonpayable",
        "inputs": [
            {"name": "operatorId", "type": "string"},
            {"name": "modelHash", "type": "bytes32"},
            {"name": "metadata", "type": "bytes"},
        ],
        "outputs": [],
    },
    {
        "type": "function", "name": "modelOf", "stateMutability": "view",
        "inputs": [{"name": "operator", "type": "address"}],
        "outputs": [
            {"name": "modelHash", "type": "bytes32"},
            {"name": "operatorId", "type": "string"},
            {"name": "registeredAt", "type": "uint256"},
            {"name": "metadata", "type": "bytes"},
        ],
    },
    {
        "type": "function", "name": "isRegistered", "stateMutability": "view",
        "inputs": [{"name": "modelHash", "type": "bytes32"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "type": "event", "name": "ModelRegistered", "anonymous": False,
        "inputs": [
            {"name": "operator",   "type": "address", "indexed": True},
            {"name": "modelHash",  "type": "bytes32", "indexed": True},
            {"name": "operatorId", "type": "string",  "indexed": False},
            {"name": "metadata",   "type": "bytes",   "indexed": False},
        ],
    },
]
