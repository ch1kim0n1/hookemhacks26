#!/usr/bin/env python3
"""
attacker — scenario launcher.

Select an adversary simulation to run against the defender's mempool stream.
Each scenario publishes its own tx sequence to `sentinel.mempool.pending`;
the detection-engine picks them up and the defender console renders the
resulting threat. Every scenario always fails — demo spec.

Usage:
    REDIS_URL=redis://<defender>:6379 python3 attacker.py              # menu
    REDIS_URL=redis://<defender>:6379 python3 attacker.py blitz        # direct
    REDIS_URL=redis://<defender>:6379 python3 attacker.py --scenario stealth
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import socket
import sys
import time

# Support both `python3 attacker.py` and `python3 -m demo.attacker`.
if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from demo._common import (
        AMBER, BOLD, DIM, GRAY, GREEN, RED, RESET, RULE, STEEL, ATTACKER_EOA,
        build_publisher, line,
    )
    from demo.scenarios import (
        blitz, recon, stealth, sandwich, pingflood, dust, reentrant, routine,
    )
else:
    from ._common import (
        AMBER, BOLD, DIM, GRAY, GREEN, RED, RESET, RULE, STEEL, ATTACKER_EOA,
        build_publisher, line,
    )
    from .scenarios import (
        blitz, recon, stealth, sandwich, pingflood, dust, reentrant, routine,
    )


SCENARIOS = {
    blitz.LABEL:     blitz,
    recon.LABEL:     recon,
    stealth.LABEL:   stealth,
    sandwich.LABEL:  sandwich,
    pingflood.LABEL: pingflood,
    dust.LABEL:      dust,
    reentrant.LABEL: reentrant,
    routine.LABEL:   routine,
}
# Ordering: loud attacks first, then specialised, benign last.
ORDER = [
    blitz.LABEL,
    recon.LABEL,
    stealth.LABEL,
    sandwich.LABEL,
    pingflood.LABEL,
    dust.LABEL,
    reentrant.LABEL,
    routine.LABEL,
]


# ──────────────────────────────────────────────────────────────────────────────
# boot sequence
# ──────────────────────────────────────────────────────────────────────────────
def _hostname_short() -> str:
    try:
        return socket.gethostname().split(".")[0][:14]
    except Exception:
        return "unknown"


def _boot_line(label: str, value: str, status: str, *, char_delay: float = 0.004) -> None:
    """Render `  label  value ...... [status]` with a typewriter feel."""
    prefix = f"  {GRAY}{label:<14}{RESET}"
    for ch in prefix:
        sys.stdout.write(ch)
        sys.stdout.flush()
    # value
    for ch in value:
        sys.stdout.write(ch)
        sys.stdout.flush()
        time.sleep(char_delay)
    # dots fill
    pad = 62 - 16 - _visible_len(value)
    sys.stdout.write(" " + "." * max(pad, 3) + " ")
    sys.stdout.flush()
    sys.stdout.write(f"[{status}]\n")
    sys.stdout.flush()


def _visible_len(s: str) -> int:
    out, i = 0, 0
    while i < len(s):
        if s[i] == "\033":
            while i < len(s) and s[i] != "m":
                i += 1
            i += 1
            continue
        out += 1
        i += 1
    return out


def _logo() -> None:
    # minimal, sharp — no ASCII art bloat
    print()
    print(f"{DIM}{GRAY}  ┌─────────────────────────────────────────────────────────────────────┐{RESET}")
    print(f"{DIM}{GRAY}  │{RESET}   {BOLD}{RED}sentinel{RESET} {GRAY}/{RESET} {BOLD}{STEEL}adversary-runtime{RESET}   "
          f"{DIM}{GRAY}· v0.7 · authorized operator only{RESET}   {DIM}{GRAY}│{RESET}")
    print(f"{DIM}{GRAY}  └─────────────────────────────────────────────────────────────────────┘{RESET}")
    print()


def boot_sequence(redis_url: str, mode: str, rpc_url: str, operator_eoa: str) -> None:
    _logo()
    _boot_line(
        "[auth]",
        f"{STEEL}operator {operator_eoa[:10]}…{operator_eoa[-4:]}{RESET}",
        f"{GREEN}ok{RESET}",
    )
    time.sleep(0.08)
    if mode == "real":
        _boot_line(
            "[chain]",
            f"{STEEL}rpc endpoint     {DIM}{rpc_url}{RESET}",
            f"{GREEN}live{RESET}",
        )
    else:
        _boot_line(
            "[link]",
            f"{STEEL}defender uplink  {DIM}{redis_url}{RESET}",
            f"{GREEN}online{RESET}",
        )
    time.sleep(0.08)
    fabric = (f"{DIM}anvil · chainId 31337{RESET}" if mode == "real"
              else f"{DIM}mainnet-fork · 0x{random.randint(0x1000, 0xffff):04x}{RESET}")
    _boot_line(
        "[net]",
        f"{STEEL}target fabric    {fabric}",
        f"{GREEN}reached{RESET}",
    )
    time.sleep(0.08)
    _boot_line(
        "[bank]",
        f"{STEEL}scenario bank    {DIM}./scenarios{RESET}",
        f"{GREEN}{len(SCENARIOS)} loaded{RESET}",
    )
    time.sleep(0.08)
    mode_tag = (f"{GREEN}real{RESET}" if mode == "real"
                else f"{AMBER}simulated{RESET}")
    _boot_line(
        "[sig]",
        f"{STEEL}signature feed   {DIM}sentinel.mempool.pending{RESET}",
        f"{mode_tag}",
    )
    time.sleep(0.18)
    print()


# ──────────────────────────────────────────────────────────────────────────────
# menu
# ──────────────────────────────────────────────────────────────────────────────
def print_menu() -> None:
    print(f"  {DIM}{GRAY}──{RESET}  {BOLD}{STEEL}select operation{RESET}  {DIM}{GRAY}──{RESET}")
    print()
    for i, key in enumerate(ORDER, start=1):
        s = SCENARIOS[key]
        idx = f"{BOLD}{RED}[{i}]{RESET}"
        name = f"{BOLD}{STEEL}{s.LABEL:<9}{RESET}"
        desc = f"{STEEL}{s.DESCRIPTION}{RESET}"
        meta = (
            f"{DIM}{GRAY}{s.DURATION}{RESET}  "
            f"{DIM}{GRAY}·{RESET}  {DIM}{GRAY}{s.STAGES}{RESET}  "
            f"{DIM}{GRAY}·{RESET}  {DIM}{GRAY}{s.PROFILE}{RESET}"
        )
        op = f"{DIM}{AMBER}{s.OPCODE}{RESET}"
        print(f"    {idx}  {name}  {desc}  {op}")
        print(f"             {DIM}{GRAY}└─{RESET}  {meta}")
        print()


def _flash_cursor(prompt: str, frames: int = 6) -> None:
    """Brief blinking caret before we hand off to input()."""
    sys.stdout.write(prompt)
    sys.stdout.flush()
    for i in range(frames):
        sys.stdout.write(f"{BOLD}{RED}█{RESET}" if i % 2 == 0 else " ")
        sys.stdout.flush()
        time.sleep(0.22)
        sys.stdout.write("\b")
        sys.stdout.flush()


def _resolve_choice(raw: str) -> str | None:
    raw = raw.strip().lower()
    if not raw:
        return None
    if raw in {"q", "quit", "exit"}:
        return "__abort__"
    if raw.isdigit():
        idx = int(raw) - 1
        if 0 <= idx < len(ORDER):
            return ORDER[idx]
        return None
    if raw in SCENARIOS:
        return raw
    return None


def prompt_choice(max_attempts: int = 3) -> str | None:
    print_menu()
    for attempt in range(max_attempts):
        prompt = f"  {DIM}{GRAY}›{RESET} {STEEL}"
        _flash_cursor(prompt, frames=4)
        try:
            raw = input("").strip()
        except EOFError:
            sys.stdout.write(RESET)
            return None
        sys.stdout.write(RESET)
        result = _resolve_choice(raw)
        if result == "__abort__":
            return None
        if result is not None:
            print()
            line(f"  {DIM}{GRAY}› dispatching{RESET} {BOLD}{STEEL}{result}{RESET}{DIM}{GRAY}  "
                 f"{SCENARIOS[result].OPCODE}{RESET}", 0.008)
            time.sleep(0.35)
            print()
            return result
        # rejected — brief flash then re-prompt
        print(f"  {RED}× rejected{RESET}  {DIM}{GRAY}unknown operation. try 1-{len(ORDER)} or q to abort.{RESET}")
        time.sleep(0.4)
    print(f"  {RED}aborted:{RESET} {DIM}{GRAY}too many invalid selections.{RESET}")
    return None


# ──────────────────────────────────────────────────────────────────────────────
# cli
# ──────────────────────────────────────────────────────────────────────────────
def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="SENTINEL adversary simulation launcher",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "scenario", nargs="?", choices=list(SCENARIOS.keys()),
        help="scenario to run; omit for interactive menu",
    )
    p.add_argument(
        "--scenario", dest="scenario_flag", choices=list(SCENARIOS.keys()),
        help="alias for positional",
    )
    p.add_argument(
        "--redis-url", default=os.environ.get("REDIS_URL", "redis://127.0.0.1:6379"),
        help="defender redis endpoint (default: $REDIS_URL or redis://127.0.0.1:6379)",
    )
    p.add_argument(
        "--mode", choices=("auto", "real", "simulated"),
        default=os.environ.get("DEMO_MODE", "auto"),
        help="auto = prefer real chain, fall back to simulated (default); "
             "real = require anvil + deployed contracts, no fallback; "
             "simulated = always inject synthetic txs into redis.",
    )
    p.add_argument(
        "--rpc-url", default=os.environ.get("RPC_URL", "http://127.0.0.1:8545"),
        help="EVM RPC endpoint for real mode (default: $RPC_URL or http://127.0.0.1:8545)",
    )
    p.add_argument(
        "--attacker-key", default=os.environ.get("ATTACKER_KEY"),
        help="attacker EOA private key for real mode "
             "(default: $ATTACKER_KEY or Anvil account #5)",
    )
    p.add_argument(
        "--addresses-file", default=os.environ.get("ADDRESSES_FILE"),
        help="path to deployed-contracts JSON for real mode "
             "(default: $ADDRESSES_FILE or config/addresses.local.json)",
    )
    p.add_argument(
        "--list", action="store_true", help="print scenario list and exit",
    )
    p.add_argument(
        "--no-boot", action="store_true", help="skip the boot sequence (for testing)",
    )
    return p.parse_args(argv)


async def main(argv: list[str]) -> int:
    args = parse_args(argv)

    if args.list:
        print_menu()
        return 0

    publisher, resolved_mode = await build_publisher(
        redis_url=args.redis_url,
        mode=args.mode,
        rpc_url=args.rpc_url,
        attacker_key=args.attacker_key,
        addresses_file=args.addresses_file,
    )
    if publisher is None:
        return 1

    choice = args.scenario or args.scenario_flag
    if choice is None:
        if not args.no_boot:
            boot_sequence(
                args.redis_url,
                resolved_mode,
                args.rpc_url,
                publisher.attacker_address,
            )
        choice = prompt_choice()
        if choice is None:
            print(f"  {DIM}{GRAY}session closed.{RESET}", file=sys.stderr)
            await publisher.aclose()
            return 2

    scenario = SCENARIOS[choice]
    return await scenario.run(publisher)


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main(sys.argv[1:])))
    except KeyboardInterrupt:
        print(f"\n{DIM}{GRAY}aborted.{RESET}")
        sys.exit(130)
