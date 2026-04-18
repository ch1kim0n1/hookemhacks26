"""Package verified defense updates and submit them to `DefenseProtocol`.

A defense update is the pair `(rule_diff_hash, model_delta_hash)` produced
by the adversarial training loop, together with the zkProof that binds
both hashes to the attack that motivated them. The publisher calls
`DefenseProtocol.publishDefenseUpdate(updateId, ruleDiffHash,
modelDeltaHash, derivedFromAttackHash, zkProof, publicInputs)` and returns
the tx receipt so callers can log / dashboard it.

When web3 (or the address / private key) is missing, the function still
returns a structured dict so unit tests and the dev-mode demo can
exercise the encoding path without an RPC.
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import Any

try:
    from eth_account import Account
    from web3 import Web3

    HAS_WEB3 = True
except ImportError:  # pragma: no cover - deps missing in slim envs
    HAS_WEB3 = False


# Minimal hand-authored ABI fragment — avoids a forge-out build
# dependency. Keep in sync with contracts/src/DefenseProtocol.sol.
DEFENSE_PROTOCOL_ABI: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "publishDefenseUpdate",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "updateId", "type": "bytes32"},
            {"name": "ruleDiffHash", "type": "bytes32"},
            {"name": "modelDeltaHash", "type": "bytes32"},
            {"name": "derivedFromAttackHash", "type": "bytes32"},
            {"name": "zkProof", "type": "bytes"},
            {"name": "publicInputs", "type": "bytes32[]"},
        ],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "type": "event",
        "name": "DefenseUpdatePublished",
        "anonymous": False,
        "inputs": [
            {"name": "updateId", "type": "bytes32", "indexed": True},
            {"name": "derivedFromAttackHash", "type": "bytes32", "indexed": True},
            {"name": "ruleDiffHash", "type": "bytes32", "indexed": False},
            {"name": "modelDeltaHash", "type": "bytes32", "indexed": False},
            {"name": "publisher", "type": "address", "indexed": True},
        ],
    },
]


def compute_update_id(
    *,
    rule_diff_hash: bytes,
    model_delta_hash: bytes,
    derived_from_attack_hash: bytes,
    zk_proof: bytes,
) -> bytes:
    """Deterministic update id so retries dedupe on-chain.

    sha256(ruleDiffHash || modelDeltaHash || attackHash || sha256(zkProof)).
    """
    digest = hashlib.sha256()
    digest.update(_as_bytes32(rule_diff_hash))
    digest.update(_as_bytes32(model_delta_hash))
    digest.update(_as_bytes32(derived_from_attack_hash))
    digest.update(hashlib.sha256(zk_proof).digest())
    return digest.digest()


def build_publish_payload(
    *,
    rule_diff_hash: bytes,
    model_delta_hash: bytes,
    derived_from_attack_hash: bytes,
    zk_proof: bytes,
    old_policy_hash: bytes,
    new_policy_hash: bytes,
) -> dict[str, Any]:
    """Return the structured calldata for `publishDefenseUpdate`.

    publicInputs mirror the defense-update-correctness journal slots:
        [oldPolicyHash, newPolicyHash, derivedFromAttackHash, modelDeltaHash]
    """
    rule_diff_hash = _as_bytes32(rule_diff_hash)
    model_delta_hash = _as_bytes32(model_delta_hash)
    derived_from_attack_hash = _as_bytes32(derived_from_attack_hash)
    old_policy_hash = _as_bytes32(old_policy_hash)
    new_policy_hash = _as_bytes32(new_policy_hash)

    update_id = compute_update_id(
        rule_diff_hash=rule_diff_hash,
        model_delta_hash=model_delta_hash,
        derived_from_attack_hash=derived_from_attack_hash,
        zk_proof=zk_proof,
    )
    public_inputs = [
        old_policy_hash,
        new_policy_hash,
        derived_from_attack_hash,
        model_delta_hash,
    ]
    return {
        "updateId": update_id,
        "ruleDiffHash": rule_diff_hash,
        "modelDeltaHash": model_delta_hash,
        "derivedFromAttackHash": derived_from_attack_hash,
        "zkProof": zk_proof,
        "publicInputs": public_inputs,
    }


def publish_defense_update(
    *,
    rpc_url: str | None = None,
    defense_protocol_address: str | None = None,
    private_key: str | None = None,
    rule_diff_hash: bytes = b"\x00" * 32,
    model_delta_hash: bytes = b"\x00" * 32,
    derived_from_attack_hash: bytes = b"\x00" * 32,
    old_policy_hash: bytes = b"\x00" * 32,
    new_policy_hash: bytes = b"\x00" * 32,
    proof: bytes = b"",
    gas: int = 600_000,
) -> dict[str, Any]:
    """Submit a defense update to `DefenseProtocol.publishDefenseUpdate`.

    Returns a structured dict describing the outcome:
      - `ok=True,  tx_hash=..., update_id=...` on successful submission
      - `ok=False, error=...`                  when inputs/env are missing
      - `ok=False, queued=True, payload=...`   when web3 is absent (dev)
    """
    payload = build_publish_payload(
        rule_diff_hash=rule_diff_hash,
        model_delta_hash=model_delta_hash,
        derived_from_attack_hash=derived_from_attack_hash,
        zk_proof=proof,
        old_policy_hash=old_policy_hash,
        new_policy_hash=new_policy_hash,
    )

    if not HAS_WEB3:
        return {
            "ok": False,
            "queued": True,
            "payload": _payload_to_hex(payload),
            "error": "web3/eth-account not installed",
        }

    rpc = rpc_url or os.getenv("RPC_URL", "http://127.0.0.1:8545")
    addr = defense_protocol_address or os.getenv("DEFENSE_PROTOCOL_ADDRESS", "")
    key = private_key or os.getenv("CLAWGUARD_PRIVATE_KEY", "")
    if not addr or not key:
        return {
            "ok": False,
            "queued": True,
            "payload": _payload_to_hex(payload),
            "error": "DEFENSE_PROTOCOL_ADDRESS and CLAWGUARD_PRIVATE_KEY required",
        }

    try:
        w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 5}))
        if not w3.is_connected():
            return {
                "ok": False,
                "payload": _payload_to_hex(payload),
                "error": f"rpc unreachable: {rpc}",
            }

        acct = Account.from_key(key)
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(addr), abi=DEFENSE_PROTOCOL_ABI
        )
        tx = contract.functions.publishDefenseUpdate(
            payload["updateId"],
            payload["ruleDiffHash"],
            payload["modelDeltaHash"],
            payload["derivedFromAttackHash"],
            payload["zkProof"],
            payload["publicInputs"],
        ).build_transaction(
            {
                "from": acct.address,
                "nonce": w3.eth.get_transaction_count(acct.address),
                "gas": gas,
                "gasPrice": w3.eth.gas_price,
            }
        )
        signed = acct.sign_transaction(tx)
        raw = getattr(signed, "raw_transaction", None) or getattr(
            signed, "rawTransaction", None
        )
        tx_hash = w3.eth.send_raw_transaction(raw)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=30)
        return {
            "ok": receipt.status == 1,
            "tx_hash": tx_hash.hex(),
            "update_id": payload["updateId"].hex(),
            "block": receipt.blockNumber,
        }
    except Exception as exc:  # pragma: no cover - network-dependent
        return {
            "ok": False,
            "payload": _payload_to_hex(payload),
            "error": f"{type(exc).__name__}: {exc}",
        }


# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------

def _as_bytes32(value: bytes) -> bytes:
    if len(value) == 32:
        return value
    if len(value) < 32:
        return value.rjust(32, b"\x00")
    return value[:32]


def _payload_to_hex(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "updateId": "0x" + payload["updateId"].hex(),
        "ruleDiffHash": "0x" + payload["ruleDiffHash"].hex(),
        "modelDeltaHash": "0x" + payload["modelDeltaHash"].hex(),
        "derivedFromAttackHash": "0x" + payload["derivedFromAttackHash"].hex(),
        "zkProof": "0x" + payload["zkProof"].hex(),
        "publicInputs": ["0x" + h.hex() for h in payload["publicInputs"]],
    }


# Kept for CLI introspection / debugging.
if __name__ == "__main__":  # pragma: no cover
    result = publish_defense_update()
    print(json.dumps(result, indent=2, default=str))
