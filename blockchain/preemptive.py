"""Preemptive strike — Python port of SENTINEL `preemptive-strike`.

Matches attacker address + 4-byte selector, submits PauseController tx,
publishes threat signatures to Redis + optional ThreatRegistry.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

def _attack_selector() -> str:
    """First 4 bytes of keccak256('attack(address,uint256)')."""
    try:
        from web3 import Web3

        h = Web3.keccak(text="attack(address,uint256)")
        return Web3.to_hex(h[:4])
    except Exception:  # noqa: BLE001
        return "0xc2985578"  # common stub if web3 unavailable


ATTACK_SELECTOR = _attack_selector()


@dataclass
class AttackerPattern:
    attacker: str
    selector: str
    victim_protocol: str


class MempoolMatcher:
    """In-memory set of (attacker, selector) -> victim."""

    def __init__(self) -> None:
        self._patterns: list[AttackerPattern] = []

    def add_attacker_pattern(self, attacker: str, selector: str, victim: str) -> None:
        self._patterns.append(
            AttackerPattern(
                attacker=attacker.lower(),
                selector=selector.lower() if selector.startswith("0x") else "0x" + selector,
                victim_protocol=victim.lower(),
            )
        )

    @property
    def pattern_count(self) -> int:
        return len(self._patterns)

    def match(self, tx_from: str, tx_to: str, selector: str) -> AttackerPattern | None:
        f, t, s = tx_from.lower(), tx_to.lower(), selector.lower()
        for p in self._patterns:
            if t == p.attacker and s == p.selector:
                return p
        return None


@dataclass
class PreemptiveStrikeService:
    """Wires matcher + optional executor (web3 tx)."""

    rpc_url: str = field(default_factory=lambda: os.getenv("RPC_URL", "http://127.0.0.1:8545"))
    matcher: MempoolMatcher = field(default_factory=MempoolMatcher)
    dedup_ms: int = 30_000
    _recent_pauses: dict[str, float] = field(default_factory=dict)

    def load_addresses(self, path: str | Path | None = None) -> dict[str, Any]:
        p = Path(path or os.getenv("ADDRESSES_FILE") or Path(__file__).resolve().parents[1] / "config" / "addresses.local.json")
        return json.loads(p.read_text())

    def seed_from_config(self, addresses: dict[str, Any]) -> None:
        att = addresses.get("FlashLoanAttacker")
        vic = addresses.get("VictimLendingPool")
        if att and vic:
            self.matcher.add_attacker_pattern(att, ATTACK_SELECTOR, vic)
            log.info("seeded preemptive pattern attacker=%s victim=%s", att, vic)
