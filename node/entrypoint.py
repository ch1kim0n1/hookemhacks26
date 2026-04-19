"""ClawGuard node entrypoint.

Loops forever doing three cheap things:

1. Announce who it is (node id, KMS-derived Ethereum address, region).
2. Poll the ThreatRegistry contract on Base Sepolia for recent attacks.
3. Keep a structured heartbeat line flowing so the dashboard / CloudWatch
   observability dashboard has something to render.

The entrypoint is deliberately short: detection fan-in, ZK attestation, and
the full FastAPI stack run elsewhere (on Lambda / the main API). A node's job
is to be a blockchain-visible validator identity plus a passive observer of
the shared threat cache.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
from dataclasses import asdict, dataclass

logger = logging.getLogger("clawguard.node")


@dataclass(frozen=True)
class NodeConfig:
    node_id: str
    kms_key_id: str
    region: str
    registry_address: str
    rpc_url: str
    bedrock_model_id: str
    poll_interval_seconds: int
    heartbeat_interval_seconds: int
    image_sha: str

    @classmethod
    def from_env(cls) -> NodeConfig:
        return cls(
            node_id=os.environ.get("CLAWGUARD_NODE_ID", "unknown"),
            kms_key_id=os.environ.get("CLAWGUARD_KMS_KEY_ID", "").strip(),
            region=os.environ.get("AWS_REGION", "us-east-1"),
            registry_address=os.environ.get("CLAWGUARD_REGISTRY_ADDRESS", "").strip(),
            rpc_url=os.environ.get("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org"),
            bedrock_model_id=os.environ.get(
                "CLAWGUARD_BEDROCK_MODEL_ID",
                "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            ),
            poll_interval_seconds=int(os.environ.get("CLAWGUARD_POLL_SECONDS", "30")),
            heartbeat_interval_seconds=int(
                os.environ.get("CLAWGUARD_HEARTBEAT_SECONDS", "60")
            ),
            image_sha=os.environ.get("CLAWGUARD_IMAGE_SHA", "unknown"),
        )


class _Lifecycle:
    """SIGTERM-aware sleep loop so ECS stop/kill is graceful."""

    def __init__(self) -> None:
        self._stop = False
        signal.signal(signal.SIGTERM, self._handle)
        signal.signal(signal.SIGINT, self._handle)

    def _handle(self, _sig: int, _frame) -> None:
        logger.info(json.dumps({"event": "shutdown_requested"}))
        self._stop = True

    @property
    def running(self) -> bool:
        return not self._stop

    def sleep(self, seconds: float) -> None:
        end = time.monotonic() + seconds
        while self.running and time.monotonic() < end:
            time.sleep(min(1.0, end - time.monotonic()))


def _configure_logging() -> None:
    """Emit newline-delimited JSON so CloudWatch Logs Insights can parse fields."""
    fmt = os.environ.get("LOG_FORMAT", "json")
    if fmt == "json":
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        root = logging.getLogger()
        root.handlers = [handler]
        root.setLevel(os.environ.get("LOG_LEVEL", "INFO"))
    else:
        logging.basicConfig(
            level=os.environ.get("LOG_LEVEL", "INFO"),
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )


def _emit(event: str, **fields) -> None:
    payload = {"event": event, **fields}
    logger.info(json.dumps(payload, default=str))


def _derive_address(kms_key_id: str) -> str:
    """Ask KMS once for the public key and cache the derived Ethereum address.

    Returns ``"kms-unavailable"`` if KMS cannot be reached — the node stays up
    and keeps polling the chain; an operator will see the structured log line.
    """
    from skill.chain.kms_signer import KmsSigner

    try:
        return KmsSigner(kms_key_id).address
    except Exception as exc:  # broad: boto3 ClientError, missing deps, etc.
        _emit("kms_address_error", error=f"{type(exc).__name__}: {exc}")
        return "kms-unavailable"


def _web3_client(rpc_url: str):
    try:
        from web3 import Web3
    except ImportError as exc:
        _emit("web3_import_error", error=str(exc))
        return None
    return Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 10}))


def _poll_registry(w3, contract, limit: int = 10) -> list[dict]:
    if contract is None:
        return []
    try:
        raw = contract.functions.getRecentAttacks(limit).call()
    except Exception as exc:
        _emit("poll_error", error=f"{type(exc).__name__}: {exc}")
        return []
    results = []
    for entry in raw:
        results.append(
            {
                "pattern_hash": entry[0].hex() if hasattr(entry[0], "hex") else entry[0],
                "category": entry[1],
                "reporter": entry[3],
                "timestamp": entry[4],
                "block_number": entry[5],
            }
        )
    return results


# Minimal ABI — only the read we need on a node.
REGISTRY_ABI = [
    {
        "inputs": [{"name": "count", "type": "uint256"}],
        "name": "getRecentAttacks",
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
    },
]


def _registry_contract(w3, address: str):
    if w3 is None or not address:
        return None
    try:
        from web3 import Web3

        return w3.eth.contract(address=Web3.to_checksum_address(address), abi=REGISTRY_ABI)
    except Exception as exc:
        _emit("contract_init_error", error=f"{type(exc).__name__}: {exc}")
        return None


def main() -> int:
    _configure_logging()
    config = NodeConfig.from_env()
    _emit("startup", **asdict(config))

    address = _derive_address(config.kms_key_id) if config.kms_key_id else "no-kms"
    _emit(
        "identity",
        node_id=config.node_id,
        signer_address=address,
        kms_key_id=config.kms_key_id,
    )

    w3 = _web3_client(config.rpc_url)
    contract = _registry_contract(w3, config.registry_address)

    lifecycle = _Lifecycle()
    last_heartbeat = 0.0
    iteration = 0

    while lifecycle.running:
        iteration += 1
        recent = _poll_registry(w3, contract)
        _emit(
            "poll",
            iteration=iteration,
            recent_count=len(recent),
            recent_preview=[r.get("pattern_hash") for r in recent[:3]],
        )

        now = time.monotonic()
        if now - last_heartbeat >= config.heartbeat_interval_seconds:
            _emit(
                "heartbeat",
                node_id=config.node_id,
                signer_address=address,
                registry=config.registry_address,
                bedrock_model_id=config.bedrock_model_id,
                iteration=iteration,
            )
            last_heartbeat = now

        lifecycle.sleep(config.poll_interval_seconds)

    _emit("shutdown", node_id=config.node_id, iterations=iteration)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
