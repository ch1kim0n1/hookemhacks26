#!/usr/bin/env python3
"""Verify RPC + deployed bytecode for ClawGuard contracts on Base Sepolia (stdlib only).

  python scripts/verify_base_sepolia.py

Exit 0 if RPC works and every *set* address has bytecode. Exit 1 on failure.
Unset addresses → SKIP. Expected chain: 84532 (Base Sepolia).

See docs/BASE_SEPOLIA.md
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

EXPECTED_CHAIN_ID = 84532

_ADDRESS_VARS = (
    "CLAWGUARD_REGISTRY_ADDRESS",
    "DEFENSE_PROTOCOL_ADDRESS",
    "CONSENSUS_VOTING_ADDRESS",
    "PAUSE_CONTROLLER_ADDRESS",
    "VICTIM_LENDING_POOL_ADDRESS",
)


def _rpc(rpc_url: str, method: str, params: list) -> dict:
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    ).encode()
    req = urllib.request.Request(
        rpc_url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "clawguard-verify/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def _checksum(addr: str) -> str:
    """Minimal validation: 0x + 40 hex (EIP-55 optional)."""
    a = addr.strip().lower()
    if not a.startswith("0x") or len(a) != 42:
        raise ValueError(f"invalid address length: {addr!r}")
    int(a[2:], 16)  # raises if non-hex
    return addr


def main() -> int:
    rpc = os.getenv("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org").strip()
    try:
        chain = int(_rpc(rpc, "eth_chainId", [])["result"], 16)
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, ValueError) as e:
        print(f"error: RPC {rpc!r} — {e}", file=sys.stderr)
        return 1

    print(f"chain_id={chain} (expected Base Sepolia {EXPECTED_CHAIN_ID})")
    if chain != EXPECTED_CHAIN_ID:
        print("warning: unexpected chain — verify BASE_SEPOLIA_RPC_URL", file=sys.stderr)

    failed = False
    any_set = False
    for var in _ADDRESS_VARS:
        raw = os.getenv(var, "").strip()
        if not raw:
            print(f"SKIP {var}: not set")
            continue
        any_set = True
        try:
            addr = _checksum(raw)
        except ValueError as e:
            print(f"FAIL {var}: {e}", file=sys.stderr)
            failed = True
            continue
        try:
            code_hex = _rpc(rpc, "eth_getCode", [addr, "latest"])["result"]
        except (urllib.error.URLError, KeyError) as e:
            print(f"FAIL {var}: eth_getCode {e}", file=sys.stderr)
            failed = True
            continue
        n = (len(code_hex) - 2) // 2 if code_hex.startswith("0x") else 0
        if n <= 0:
            print(f"FAIL {var}: no contract code at {addr}", file=sys.stderr)
            failed = True
        else:
            print(f"OK   {var}: {addr} ({n} bytes)")

    if not any_set:
        print(
            "note: no contract addresses in env — set CLAWGUARD_*_ADDRESS after deploy.",
            file=sys.stderr,
        )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
