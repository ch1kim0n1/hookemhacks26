#!/usr/bin/env python3
"""
sentinel — live threat console.

Runs on the defender host alongside the detection stack. Subscribes to the
mempool, per-operator verdict, and federated-consensus streams on Redis
and renders a clean, high-contrast timeline for a non-technical audience.
The detection-operator processes and federation-coordinator do the real
work; this is purely a viewer.

Usage:
    REDIS_URL=redis://127.0.0.1:6379 python3 defender.py
    FEDERATION_OPERATORS=alpha,beta,gamma python3 defender.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime

import redis.asyncio as redis

RESET = "\033[0m"
DIM = "\033[2m"
BOLD = "\033[1m"
RED = "\033[38;5;196m"
AMBER = "\033[38;5;214m"
GREEN = "\033[38;5;46m"
GRAY = "\033[38;5;244m"
STEEL = "\033[38;5;250m"
BLUE = "\033[38;5;75m"
CYAN = "\033[38;5;80m"

RULE = f"{DIM}{GRAY}{'─' * 78}{RESET}"

ATTACK_SELECTOR_HEX = "52fba25c"  # keccak256('attack(address,uint256)')[0:4]


def banner() -> None:
    print(RULE)
    print(f"{BOLD}{STEEL}  sentinel{RESET}  {GRAY}live threat console · federated{RESET}")
    print(f"{DIM}{GRAY}  defender-host :: mempool + operators + coordinator :: armed{RESET}")
    print(RULE)
    print()


def ts() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


def short(addr: str) -> str:
    if not addr or not addr.startswith("0x") or len(addr) < 10:
        return addr or "—"
    return f"{addr[:6]}…{addr[-4:]}"


def classify_tx(tx: dict, addresses: dict) -> tuple[str, str]:
    to = (tx.get("to") or "").lower()
    selector = (tx.get("selector") or "").lower()
    if to == addresses.get("flash_provider", "").lower():
        return ("flash-loan", AMBER)
    if to == addresses.get("oracle_pair", "").lower():
        return ("oracle-swap", AMBER)
    if to == addresses.get("attacker_contract", "").lower() and selector.endswith(ATTACK_SELECTOR_HEX):
        return ("exploit-call", RED)
    return ("transfer", GRAY)


def render_mempool(tx: dict, addresses: dict) -> None:
    tag, color = classify_tx(tx, addresses)
    frm = short(tx.get("from", ""))
    to = short(tx.get("to", ""))
    sel = (tx.get("selector") or "—")[:10]
    print(
        f"  {DIM}{GRAY}{ts()}{RESET}  "
        f"{BLUE}mempool{RESET}  "
        f"{color}{tag:<12}{RESET}  "
        f"{STEEL}{frm}{RESET} → {STEEL}{to}{RESET}  "
        f"{DIM}{sel}{RESET}"
    )


def render_operator_verdict(evt: dict) -> None:
    """Render one `OperatorVerdict@1` — a single operator's attestation
    before federation has weighed in."""
    op_id = evt.get("operatorId", "?")
    level = evt.get("level", "noise")
    bp = int(evt.get("confidence", 0))
    pct = bp / 100
    model = (evt.get("modelHash", "") or "")
    model_short = model[:8] + "…" if len(model) > 10 else model
    anomaly = float(evt.get("anomalyScore", 0.0))
    seq = float(evt.get("sequenceScore", 0.0))

    color = RED if level == "confirmed" else AMBER if level == "candidate" else GRAY
    print(
        f"  {DIM}{GRAY}{ts()}{RESET}  "
        f"{CYAN}operator{RESET}  "
        f"{BOLD}{STEEL}{op_id:<7}{RESET}  "
        f"{color}{level:<9}{RESET}  "
        f"{DIM}{GRAY}model{RESET} {DIM}{model_short}{RESET}  "
        f"{GRAY}anomaly{RESET} {AMBER}{anomaly:.3f}{RESET}  "
        f"{GRAY}seq{RESET} {AMBER}{seq:.3f}{RESET}  "
        f"{color}{pct:5.1f}%{RESET}"
    )


def render_candidate(evt: dict) -> None:
    """Legacy ThreatCandidateEvent (single-operator mode)."""
    bp = evt.get("confidence", 0)
    pct = bp / 100
    state = evt.get("state", "—")
    eoa = short(evt.get("attackerAddress", ""))
    bar_width = 24
    filled = int(bar_width * pct / 100)
    bar = f"{AMBER}{'█' * filled}{DIM}{'░' * (bar_width - filled)}{RESET}"
    print(
        f"  {DIM}{GRAY}{ts()}{RESET}  "
        f"{AMBER}warning{RESET}  "
        f"{STEEL}candidate threat{RESET}   "
        f"eoa {STEEL}{eoa}{RESET}  "
        f"state {AMBER}{state}{RESET}  "
        f"{bar} {AMBER}{pct:5.1f}%{RESET}"
    )


def render_confirmed(evt: dict) -> None:
    schema = evt.get("schema", "ThreatConfirmedEvent@1")
    is_federated = schema == "ThreatConfirmedEvent@2"
    bp = evt.get("confidence", 0)
    pct = bp / 100
    pattern = evt.get("pattern", "—")
    anomaly = evt.get("anomalyScore", 0.0)
    seq = evt.get("sequenceScore", 0.0)
    eoa = short((evt.get("attackerAddresses") or ["—"])[0])

    bar_width = 28
    filled = int(bar_width * pct / 100)
    bar = f"{RED}{'█' * filled}{DIM}{'░' * (bar_width - filled)}{RESET}"

    print()
    if is_federated:
        fed = evt.get("federation", {}) or {}
        k = fed.get("consensusK", "?")
        n = fed.get("consensusN", "?")
        print(f"  {BOLD}{RED}▮{RESET}  {BOLD}{RED}threat confirmed · federated{RESET}   "
              f"{DIM}{GRAY}consensus{RESET} {BOLD}{STEEL}{k}/{n}{RESET}       "
              f"{bar} {BOLD}{RED}{pct:5.1f}%{RESET}")
    else:
        print(f"  {BOLD}{RED}▮{RESET}  {BOLD}{RED}threat confirmed{RESET}                                    "
              f"{bar} {BOLD}{RED}{pct:5.1f}%{RESET}")
    print(f"     {GRAY}pattern       {RESET} {RED}{pattern}{RESET}")
    print(f"     {GRAY}eoa           {RESET} {STEEL}{eoa}{RESET}")
    print(f"     {GRAY}anomaly score {RESET} {AMBER}{anomaly:.3f}{RESET}  "
          f"{GRAY}sequence score{RESET} {AMBER}{seq:.3f}{RESET}")

    if is_federated:
        fed = evt.get("federation", {}) or {}
        atts = fed.get("operatorAttestations", []) or []
        print(f"     {GRAY}attestations  {RESET}")
        for a in atts:
            op_id = a.get("operatorId", "?")
            level = a.get("level", "?")
            a_bp = int(a.get("confidence", 0))
            a_pct = a_bp / 100
            model = (a.get("modelHash", "") or "")
            model_short = model[:10] + "…" + model[-4:] if len(model) > 14 else model
            tick = (f"{GREEN}✓{RESET}" if level == "confirmed"
                    else f"{AMBER}~{RESET}" if level == "candidate"
                    else f"{GRAY}·{RESET}")
            print(f"       {tick}  {BOLD}{STEEL}{op_id:<7}{RESET}  "
                  f"{DIM}{GRAY}model{RESET} {DIM}{model_short}{RESET}  "
                  f"{GRAY}conf{RESET} {AMBER}{a_pct:5.1f}%{RESET}  "
                  f"{GRAY}{level}{RESET}")
    print(f"     {GRAY}response      {RESET} {GREEN}pause-controller engaged · freeze() submitted{RESET}")
    print()


async def tail_stream(client: redis.Redis, stream: str, render) -> None:
    last_id = "$"
    while True:
        try:
            res = await client.xread({stream: last_id}, count=32, block=2_000)
            if not res:
                continue
            _, msgs = res[0]
            for msg_id, fields in msgs:
                last_id = msg_id
                try:
                    data = json.loads(fields.get("data", "{}"))
                except json.JSONDecodeError:
                    continue
                render(data)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"{DIM}{GRAY}  stream {stream} error: {exc}{RESET}", file=sys.stderr)
            await asyncio.sleep(1.0)


def print_federation_panel(operator_ids: list[str], threshold_k: int) -> None:
    print(f"  {DIM}{GRAY}──{RESET}  {BOLD}{STEEL}federation{RESET}  "
          f"{DIM}{GRAY}{len(operator_ids)} operators · {threshold_k}-of-{len(operator_ids)} consensus{RESET}  "
          f"{DIM}{GRAY}──{RESET}")
    for op in operator_ids:
        print(f"     {CYAN}●{RESET}  {BOLD}{STEEL}{op:<7}{RESET}  "
              f"{DIM}{GRAY}subscribed: sentinel.detection.operator.{op}{RESET}")
    print()


async def main() -> int:
    redis_url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379")
    operator_ids = [
        o.strip() for o in os.environ.get("FEDERATION_OPERATORS", "alpha,beta,gamma").split(",")
        if o.strip()
    ]
    threshold_k = int(os.environ.get("FEDERATION_THRESHOLD_K", "2"))

    addresses = {
        "attacker_contract": "0x0116686E2291dbd5e317F47faDBFb43B599786Ef",
        "victim_pool":       "0x9A676e781A523b5d0C0e43731313A708CB607508",
        "flash_provider":    "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82",
        "oracle_pair":       "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0",
    }
    addresses_file = os.environ.get("ADDRESSES_FILE")
    if addresses_file and os.path.exists(addresses_file):
        try:
            with open(addresses_file) as f:
                raw = json.load(f)
            addresses["attacker_contract"] = raw.get("FlashLoanAttacker", addresses["attacker_contract"])
            addresses["victim_pool"] = raw.get("VictimLendingPool", addresses["victim_pool"])
            addresses["flash_provider"] = raw.get("FlashLoanProvider", addresses["flash_provider"])
            addresses["oracle_pair"] = raw.get("OraclePair", addresses["oracle_pair"])
        except Exception:
            pass

    try:
        r = redis.from_url(redis_url, decode_responses=True)
        await r.ping()
    except Exception as exc:
        print(f"{RED}fatal{RESET}: cannot reach redis at {redis_url} ({exc})", file=sys.stderr)
        return 1

    banner()
    print_federation_panel(operator_ids, threshold_k)
    print(f"  {GRAY}subscribed: mempool · operator.{{alpha,beta,gamma}} · detection.confirmed{RESET}")
    print(f"  {GRAY}awaiting traffic…{RESET}")
    print()

    tasks = [
        asyncio.create_task(tail_stream(
            r, "sentinel.mempool.pending",
            lambda data: render_mempool(data.get("tx", {}), addresses),
        )),
        asyncio.create_task(tail_stream(
            r, "sentinel.detection.candidate",
            render_candidate,
        )),
        asyncio.create_task(tail_stream(
            r, "sentinel.detection.confirmed",
            render_confirmed,
        )),
    ]
    for op_id in operator_ids:
        tasks.append(asyncio.create_task(tail_stream(
            r, f"sentinel.detection.operator.{op_id}",
            render_operator_verdict,
        )))

    try:
        await asyncio.gather(*tasks)
    except (asyncio.CancelledError, KeyboardInterrupt):
        pass
    finally:
        for t in tasks:
            t.cancel()
        try:
            await r.aclose()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        print(f"\n{DIM}{GRAY}console closed.{RESET}")
        sys.exit(130)
