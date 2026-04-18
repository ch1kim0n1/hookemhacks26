"""Shared primitives for attacker scenarios.

Colour palette, narration helpers, target addresses, and the one function
that actually publishes a synthetic tx to the defender's mempool stream.
Nothing in this module talks to a real chain.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import time
import uuid
from datetime import datetime, timezone

import redis.asyncio as redis

# ──────────────────────────────────────────────────────────────────────────────
# style
# ──────────────────────────────────────────────────────────────────────────────
RESET = "\033[0m"
DIM = "\033[2m"
BOLD = "\033[1m"
RED = "\033[38;5;196m"
AMBER = "\033[38;5;214m"
GREEN = "\033[38;5;46m"
GRAY = "\033[38;5;244m"
STEEL = "\033[38;5;250m"

RULE = f"{DIM}{GRAY}{'─' * 78}{RESET}"

# ──────────────────────────────────────────────────────────────────────────────
# targets
# ──────────────────────────────────────────────────────────────────────────────
TARGETS = {
    "attacker_contract": "0x0116686E2291dbd5e317F47faDBFb43B599786Ef",
    "victim_pool":       "0x9A676e781A523b5d0C0e43731313A708CB607508",
    "flash_provider":    "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82",
    "oracle_pair":       "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0",
}

ATTACKER_EOA = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4"
SYBIL_EOA_A  = "0x9e7a5F2b0C7d6c8a3F1aBe4D9B2cF5e8A6d0C3b1"
SYBIL_EOA_B  = "0x2F8c4b1dA0e9F6a7C5b3E1d8A2f0B4c6D9a7E5f3"

FLASHLOAN_SELECTOR = "0xab9c4b5d"
SWAP_SELECTOR      = "0x022c0d9f"
TRANSFER_SELECTOR  = "0xa9059cbb"
GET_RESERVES       = "0x0902f1ac"
APPROVE_SELECTOR   = "0x095ea7b3"
BALANCE_OF         = "0x70a08231"
BORROW_SELECTOR    = "0xc5ebeaec"  # keccak("borrow(uint256)")[:4]
DEPOSIT_SELECTOR   = "0xb6b55f25"  # keccak("deposit(uint256)")[:4]


def keccak_attack_selector() -> str:
    """First 4 bytes of keccak256('attack(address,uint256)') as 0x-hex."""
    try:
        from eth_utils import function_signature_to_4byte_selector  # type: ignore
        return "0x" + function_signature_to_4byte_selector("attack(address,uint256)").hex()
    except Exception:
        # Hardcoded fallback — verified against detection-engine's own computation.
        return "0x52fba25c"


def fake_hash() -> str:
    raw = (uuid.uuid4().hex + uuid.uuid4().hex).encode()
    return "0x" + hashlib.sha256(raw).hexdigest()


# ──────────────────────────────────────────────────────────────────────────────
# narration helpers
# ──────────────────────────────────────────────────────────────────────────────
def line(text: str = "", delay: float = 0.006) -> None:
    for ch in text:
        sys.stdout.write(ch)
        sys.stdout.flush()
        time.sleep(delay)
    sys.stdout.write("\n")


def inline(text: str, delay: float = 0.006) -> None:
    for ch in text:
        sys.stdout.write(ch)
        sys.stdout.flush()
        time.sleep(delay)


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


def recon_line(label: str, value: str, delay: float = 0.005) -> None:
    """Render a `[ label ] …… value` row with aligned dots."""
    left = f"  {GRAY}[ {label:<5} ]{RESET}"
    inline(left, delay)
    gap = 58 - _visible_len(left)
    sys.stdout.write(" " + ("." * max(gap, 3)) + "  ")
    sys.stdout.flush()
    sys.stdout.write(value + "\n")
    sys.stdout.flush()


async def spinner_stage(header: str, duration: float, result: str, detail: str = "") -> None:
    """Print `header`, spinner for `duration` seconds, then `result` (+ optional detail)."""
    inline(header)
    pad = 58 - _visible_len(header)
    sys.stdout.write(" " * max(pad, 1))
    sys.stdout.flush()

    frames = ["·  ", "·· ", "···", " ··", "  ·", "   "]
    steps = max(int(duration / 0.12), 1)
    for i in range(steps):
        sys.stdout.write(f"{AMBER}{frames[i % len(frames)]}{RESET}\b\b\b")
        sys.stdout.flush()
        await asyncio.sleep(0.12)
    sys.stdout.write("   \b\b\b")
    sys.stdout.write(result)
    if detail:
        sys.stdout.write(f"   {DIM}{detail}{RESET}")
    sys.stdout.write("\n")
    sys.stdout.flush()


async def progress_bar_stage(header: str, duration: float = 0.9, colour: str = RED,
                             final: str = "blocked") -> None:
    """Print `header` then animate a progress bar that fills, ending with `final` label."""
    pad = 58 - _visible_len(header)
    width = 14
    for i in range(width):
        sys.stdout.write("\r")
        sys.stdout.write(header + " " * max(pad, 1))
        sys.stdout.write(f"{colour}{'█' * (i + 1)}{DIM}{'░' * (width - i - 1)}{RESET}")
        sys.stdout.flush()
        await asyncio.sleep(duration / width)
    sys.stdout.write("\r")
    sys.stdout.write(header + " " * max(pad, 1))
    sys.stdout.write(f"{BOLD}{colour}{final}{RESET}" + " " * (width - len(final)) + "\n")
    sys.stdout.flush()


# ──────────────────────────────────────────────────────────────────────────────
# redis publishing
# ──────────────────────────────────────────────────────────────────────────────
async def publish_tx(r: "redis.Redis", tx: dict) -> None:
    envelope = {
        "schema": "PendingTxEvent@1",
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "tx": tx,
    }
    await r.xadd(
        "sentinel.mempool.pending",
        {"data": json.dumps(envelope)},
        maxlen=10_000,
        approximate=False,
    )


def make_tx(*, frm: str, to: str, selector: str, value: str = "0", gas_price: int = 30) -> dict:
    return {
        "hash": fake_hash(),
        "from": frm.lower(),
        "to": to.lower(),
        "selector": selector,
        "value": value,
        "gasPrice": gas_price,
    }


async def connect_redis(redis_url: str) -> "redis.Redis | None":
    try:
        r = redis.from_url(redis_url, decode_responses=True)
        await r.ping()
        return r
    except Exception as exc:
        print(f"{RED}fatal{RESET}: cannot reach redis at {redis_url} ({exc})", file=sys.stderr)
        return None


# ──────────────────────────────────────────────────────────────────────────────
# publisher abstraction — real chain vs simulated redis injection
# ──────────────────────────────────────────────────────────────────────────────
class Publisher:
    """Duck-typed base. Each primitive returns the tx hash (or None in
    simulated mode — synthetic hashes aren't reused anywhere).

    Scenarios call the primitive matching the kind of tx they want to
    fire. The concrete subclass decides whether that means pushing a
    fake envelope into Redis or broadcasting a signed tx to a real node.
    """
    mode: str = "base"
    attacker_address: str = ATTACKER_EOA

    async def flash_loan(self, amount_wei: int, gas_price: int = 45): ...
    async def oracle_swap(self, amount_wei: int, gas_price: int = 52): ...
    async def probe_reserves(self, frm: str, gas_price: int = 19): ...
    async def probe_balance(self, frm: str, gas_price: int = 18): ...
    async def approve_allowance(self, frm: str, amount_wei: int = 10 ** 20,
                                gas_price: int = 22): ...
    async def cover_transfer(self, to_addr: str | None = None, amount: int = 1,
                             gas_price: int = 48): ...
    async def attack(self, loan_amount_wei: int = 10 ** 21,
                     gas_price: int = 89): ...
    async def victim_borrow(self, amount_wei: int, gas_price: int = 36): ...
    async def victim_deposit(self, amount_wei: int, gas_price: int = 28): ...
    async def aclose(self) -> None: ...


class SimulatedPublisher(Publisher):
    mode = "simulated"

    def __init__(self, redis_client: "redis.Redis"):
        self._r = redis_client

    async def flash_loan(self, amount_wei: int, gas_price: int = 45):
        await publish_tx(self._r, make_tx(
            frm=ATTACKER_EOA, to=TARGETS["flash_provider"],
            selector=FLASHLOAN_SELECTOR, value=str(amount_wei), gas_price=gas_price,
        ))

    async def oracle_swap(self, amount_wei: int, gas_price: int = 52):
        await publish_tx(self._r, make_tx(
            frm=ATTACKER_EOA, to=TARGETS["oracle_pair"],
            selector=SWAP_SELECTOR, value=str(amount_wei), gas_price=gas_price,
        ))

    async def probe_reserves(self, frm: str, gas_price: int = 19):
        await publish_tx(self._r, make_tx(
            frm=frm, to=TARGETS["oracle_pair"],
            selector=GET_RESERVES, gas_price=gas_price,
        ))

    async def probe_balance(self, frm: str, gas_price: int = 18):
        await publish_tx(self._r, make_tx(
            frm=frm, to=TARGETS["victim_pool"],
            selector=BALANCE_OF, gas_price=gas_price,
        ))

    async def approve_allowance(self, frm: str, amount_wei: int = 10 ** 20,
                                gas_price: int = 22):
        await publish_tx(self._r, make_tx(
            frm=frm, to=TARGETS["flash_provider"],
            selector=APPROVE_SELECTOR, value=str(amount_wei), gas_price=gas_price,
        ))

    async def cover_transfer(self, to_addr: str | None = None, amount: int = 1,
                             gas_price: int = 48):
        import os as _os
        dst = to_addr or ("0x" + _os.urandom(20).hex())
        await publish_tx(self._r, make_tx(
            frm=ATTACKER_EOA, to=dst,
            selector=TRANSFER_SELECTOR, gas_price=gas_price,
        ))

    async def attack(self, loan_amount_wei: int = 10 ** 21,
                     gas_price: int = 89):
        await publish_tx(self._r, make_tx(
            frm=ATTACKER_EOA, to=TARGETS["attacker_contract"],
            selector=keccak_attack_selector(), gas_price=gas_price,
        ))

    async def victim_borrow(self, amount_wei: int, gas_price: int = 36):
        await publish_tx(self._r, make_tx(
            frm=ATTACKER_EOA, to=TARGETS["victim_pool"],
            selector=BORROW_SELECTOR, value=str(amount_wei), gas_price=gas_price,
        ))

    async def victim_deposit(self, amount_wei: int, gas_price: int = 28):
        await publish_tx(self._r, make_tx(
            frm=ATTACKER_EOA, to=TARGETS["victim_pool"],
            selector=DEPOSIT_SELECTOR, value=str(amount_wei), gas_price=gas_price,
        ))

    async def aclose(self) -> None:
        try:
            await self._r.aclose()
        except Exception:
            pass


class ChainPublisher(Publisher):
    """Broadcasts real signed txs to a local node. Blocking web3 calls run
    in the default executor so the scenario's `asyncio.sleep` pacing still
    governs the demo rhythm."""
    mode = "real"

    def __init__(self, chain_client):
        self._chain = chain_client
        self.attacker_address = chain_client.from_address

    async def _run(self, fn, *args, **kwargs):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))

    async def flash_loan(self, amount_wei: int, gas_price: int = 45):
        return await self._run(self._chain.flash_loan, amount_wei, gas_price)

    async def oracle_swap(self, amount_wei: int, gas_price: int = 52):
        return await self._run(self._chain.oracle_swap, amount_wei, gas_price)

    async def probe_reserves(self, frm: str, gas_price: int = 19):
        # `frm` is ignored on-chain — we always sign from attacker EOA.
        return await self._run(self._chain.probe_reserves, gas_price)

    async def probe_balance(self, frm: str, gas_price: int = 18):
        return await self._run(self._chain.probe_balance, gas_price)

    async def approve_allowance(self, frm: str, amount_wei: int = 10 ** 20,
                                gas_price: int = 22):
        return await self._run(self._chain.approve_allowance, amount_wei, gas_price)

    async def cover_transfer(self, to_addr: str | None = None, amount: int = 1,
                             gas_price: int = 48):
        import os as _os
        dst = to_addr or ("0x" + _os.urandom(20).hex())
        return await self._run(self._chain.cover_transfer, dst, amount, gas_price)

    async def attack(self, loan_amount_wei: int = 10 ** 21,
                     gas_price: int = 89):
        return await self._run(self._chain.attack, loan_amount_wei, gas_price)

    async def victim_borrow(self, amount_wei: int, gas_price: int = 36):
        return await self._run(self._chain.victim_borrow, amount_wei, gas_price)

    async def victim_deposit(self, amount_wei: int, gas_price: int = 28):
        return await self._run(self._chain.victim_deposit, amount_wei, gas_price)

    async def aclose(self) -> None:
        return None


async def build_publisher(
    *,
    redis_url: str,
    mode: str = "auto",
    rpc_url: str | None = None,
    attacker_key: str | None = None,
    addresses_file: str | None = None,
) -> tuple[Publisher | None, str]:
    """Create the publisher appropriate for `mode`.

    mode=real        Require on-chain; no fallback. Returns (None, "") on failure.
    mode=simulated   Always publish synthetic txs to Redis.
    mode=auto        Prefer real; fall back to simulated if the chain isn't
                     reachable or the addresses file is missing.

    On fatal failure (both paths unusable) returns (None, "").
    """
    want_real = mode in ("auto", "real")
    if want_real:
        try:
            from .onchain import ChainClient
            client = ChainClient.connect(
                rpc_url=rpc_url,
                attacker_key=attacker_key,
                addresses_file=addresses_file,
            )
            return ChainPublisher(client), "real"
        except Exception as exc:
            if mode == "real":
                print(f"{RED}fatal{RESET}: real mode requested but unavailable — {exc}",
                      file=sys.stderr)
                return None, ""
            # auto: fall through to simulated
            print(f"{AMBER}note{RESET}: real chain unavailable ({exc}); "
                  f"falling back to simulated.", file=sys.stderr)

    r = await connect_redis(redis_url)
    if r is None:
        return None, ""
    return SimulatedPublisher(r), "simulated"


# ──────────────────────────────────────────────────────────────────────────────
# shared banners
# ──────────────────────────────────────────────────────────────────────────────
def opcode_banner(opcode: str, title: str) -> None:
    print(RULE)
    print(f"{BOLD}{RED}  {opcode}{RESET}  {STEEL}{title}{RESET}")
    print(f"{DIM}{GRAY}  adversary simulation :: authorized :: build {int(time.time())}{RESET}")
    print(RULE)
    print()


def failure_footer(eoa: str = ATTACKER_EOA, note: str = "") -> None:
    print()
    print(RULE)
    line(f"{BOLD}{RED}  operation failed.{RESET}", 0.02)
    line(f"{GRAY}  target secured by sentinel-guard. signature captured.{RESET}", 0.004)
    line(f"{GRAY}  eoa {eoa[:10]}…{eoa[-4:]} added to threat-registry.{RESET}", 0.004)
    if note:
        line(f"{DIM}{GRAY}  {note}{RESET}", 0.004)
    print(RULE)
