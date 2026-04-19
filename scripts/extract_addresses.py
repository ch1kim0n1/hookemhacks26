#!/usr/bin/env python3
"""Parse Foundry broadcast logs and produce a Base Sepolia addresses file.

Usage:
    forge script script/DeployAll.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
    python scripts/extract_addresses.py \\
        contracts/broadcast/DeployAll.s.sol/84532/run-latest.json \\
        > config/addresses.base-sepolia.json

Also emits a ready-to-paste `.env` fragment on stderr.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# ContractName (as emitted by forge) → .env variable
_ENV_MAP = {
    "ClawGuardRegistry": "CLAWGUARD_REGISTRY_ADDRESS",
    "ThreatRegistry": "CLAWGUARD_REGISTRY_ADDRESS",
    "DefenseProtocol": "DEFENSE_PROTOCOL_ADDRESS",
    "ConsensusVoting": "CONSENSUS_VOTING_ADDRESS",
    "PauseController": "PAUSE_CONTROLLER_ADDRESS",
    "VictimLendingPool": "VICTIM_LENDING_POOL_ADDRESS",
}


def extract(broadcast: Path) -> dict[str, str]:
    data = json.loads(broadcast.read_text())
    out: dict[str, str] = {}
    for tx in data.get("transactions", []):
        if tx.get("transactionType") != "CREATE":
            continue
        name = tx.get("contractName") or ""
        addr = tx.get("contractAddress") or ""
        if name and addr:
            out[name] = addr
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 1
    broadcast = Path(argv[1])
    if not broadcast.exists():
        print(f"error: {broadcast} not found", file=sys.stderr)
        return 1
    addrs = extract(broadcast)
    if not addrs:
        print("error: no CREATE transactions found in broadcast", file=sys.stderr)
        return 1

    chain_id = os.environ.get("CHAIN_ID", "84532")
    out = {
        "_chainId": int(chain_id),
        "_network": "base-sepolia" if chain_id == "84532" else f"chain-{chain_id}",
        **addrs,
    }
    print(json.dumps(out, indent=4, sort_keys=True))

    # Also emit .env fragment on stderr so users can `eval` or paste.
    print("\n# --- Paste into .env ---", file=sys.stderr)
    for name, addr in sorted(addrs.items()):
        env = _ENV_MAP.get(name)
        if env:
            print(f"{env}={addr}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
