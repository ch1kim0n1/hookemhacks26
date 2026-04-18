"""Web3 client for the ClawGuard on-chain threat registry on Base Sepolia."""

import json
import os
import time
import hashlib
import threading
from pathlib import Path

try:
    from web3 import Web3
    HAS_WEB3 = True
except ImportError:
    HAS_WEB3 = False

from ..db import cache_threat, check_threat_cache, get_all_cached_threats

# ABI for ClawGuardRegistry — only the functions we call
REGISTRY_ABI = json.loads("""[
    {
        "inputs": [
            {"name": "patternHash", "type": "bytes32"},
            {"name": "category", "type": "string"},
            {"name": "sampleRedacted", "type": "string"}
        ],
        "name": "publishAttack",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
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
                    {"name": "blockNumber", "type": "uint256"}
                ],
                "name": "",
                "type": "tuple[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"name": "reporter", "type": "address"}],
        "name": "getReporterStats",
        "outputs": [
            {"name": "reportCount", "type": "uint256"},
            {"name": "firstReport", "type": "uint256"},
            {"name": "lastReport", "type": "uint256"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
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
                    {"name": "blockNumber", "type": "uint256"}
                ],
                "name": "",
                "type": "tuple[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"name": "patternHash", "type": "bytes32"}],
        "name": "isKnownAttack",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"name": "patternHash", "type": "bytes32"}],
        "name": "isThreat",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "name": "patternHash", "type": "bytes32"},
            {"indexed": false, "name": "category", "type": "string"},
            {"indexed": true, "name": "reporter", "type": "address"},
            {"indexed": false, "name": "timestamp", "type": "uint256"}
        ],
        "name": "AttackPublished",
        "type": "event"
    }
]""")


class ChainClient:
    """Client for publishing and polling the on-chain threat registry."""

    def __init__(self):
        self.rpc_url = os.getenv("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org")
        self.registry_address = os.getenv("CLAWGUARD_REGISTRY_ADDRESS", "")
        self.private_key = os.getenv("CLAWGUARD_PRIVATE_KEY", "")
        self._w3 = None
        self._contract = None
        self._poll_thread = None
        self._stop_polling = threading.Event()

    @property
    def available(self) -> bool:
        return HAS_WEB3 and bool(self.registry_address) and bool(self.private_key)

    @property
    def w3(self):
        if self._w3 is None and HAS_WEB3:
            self._w3 = Web3(Web3.HTTPProvider(self.rpc_url))
        return self._w3

    @property
    def contract(self):
        if self._contract is None and self.available:
            self._contract = self.w3.eth.contract(
                address=Web3.to_checksum_address(self.registry_address),
                abi=REGISTRY_ABI,
            )
        return self._contract

    def pattern_hash(self, content: str) -> bytes:
        """Hash content for on-chain publishing."""
        return hashlib.sha256(content.encode()).digest()

    def publish_attack(self, content_hash: str, category: str,
                       sample_redacted: str) -> str | None:
        """Publish an attack pattern hash to the on-chain registry.

        Returns tx hash on success, None on failure.
        """
        if not self.available:
            return None

        try:
            pattern_hash = bytes.fromhex(content_hash.ljust(64, '0')[:64])
            account = self.w3.eth.account.from_key(self.private_key)

            tx = self.contract.functions.publishAttack(
                pattern_hash, category, sample_redacted[:200]
            ).build_transaction({
                "from": account.address,
                "nonce": self.w3.eth.get_transaction_count(account.address),
                "gas": 200000,
                "gasPrice": self.w3.eth.gas_price,
            })

            signed = self.w3.eth.account.sign_transaction(tx, self.private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)

            # Cache locally immediately
            cache_threat(content_hash, category, sample_redacted,
                         account.address)

            return tx_hash.hex()
        except Exception as e:
            print(f"[ClawGuard] Chain publish failed: {e}")
            return None

    def poll_recent(self, count: int = 20) -> list[dict]:
        """Poll the registry for recent attacks and cache them locally."""
        if not self.available:
            return []

        try:
            attacks = self.contract.functions.getRecentAttacks(count).call()
            results = []
            for attack in attacks:
                pattern_hash = attack[0].hex()
                entry = {
                    "pattern_hash": pattern_hash,
                    "category": attack[1],
                    "sample_redacted": attack[2],
                    "reporter": attack[3],
                    "timestamp": attack[4],
                    "block_number": attack[5],
                }
                # Cache locally
                cache_threat(pattern_hash, entry["category"],
                             entry["sample_redacted"], entry["reporter"],
                             entry["block_number"])
                results.append(entry)
            return results
        except Exception as e:
            print(f"[ClawGuard] Chain poll failed: {e}")
            return []

    def check_hash(self, content_hash: str) -> dict | None:
        """Check if a content hash matches any cached threat."""
        return check_threat_cache(content_hash)

    def start_polling(self, interval: int = 60):
        """Start background polling thread."""
        if self._poll_thread and self._poll_thread.is_alive():
            return

        self._stop_polling.clear()

        def _poll_loop():
            while not self._stop_polling.is_set():
                self.poll_recent()
                self._stop_polling.wait(interval)

        self._poll_thread = threading.Thread(target=_poll_loop, daemon=True)
        self._poll_thread.start()

    def stop_polling(self):
        """Stop background polling."""
        self._stop_polling.set()
        if self._poll_thread:
            self._poll_thread.join(timeout=5)
