"""reentrant — reentrancy-style repeated callback drain.

Classic reentrancy pattern: attacker calls a withdrawal-style function
that transfers before updating state, then re-enters from the receive
hook to withdraw again. Modeled here as rapid repeated `borrow()` calls
against `VictimLendingPool` — the cadence + target pattern is what the
detector keys on.

Characteristics:
    • 1 deposit + 6 rapid borrow calls, back-to-back.
    • Gas escalation across calls (attacker wants priority for the re-entries).
    • Runtime ≈ 12s.
    • Detection: ORACLE_IMPACT path won't fire, but the selector-repetition
      anomaly + attack-call confirmation will.
"""
from __future__ import annotations

import asyncio

from .._common import (
    AMBER, BOLD, DIM, GRAY, GREEN, RED, RESET, STEEL,
    Publisher, failure_footer, opcode_banner,
    progress_bar_stage, recon_line, spinner_stage,
)

OPCODE = "op-rx13"
TITLE = "reentrancy drain · repeated callback"
LABEL = "reentrant"
DESCRIPTION = "reentrancy-style repeated borrow callbacks"
DURATION = "~12s"
STAGES = "3 phases"
PROFILE = "callback cascade"


async def run(publisher: Publisher) -> int:
    opcode_banner(OPCODE, TITLE)

    recon_line("trace", f"identify state window  {STEEL}borrow(uint256) · pre-update{RESET}")
    await asyncio.sleep(0.2)
    recon_line("trace", f"receive hook target    {STEEL}attacker-eoa fallback{RESET}")
    await asyncio.sleep(0.2)
    recon_line("trace", f"callstack budget       {AMBER}6 re-entries before OOG{RESET}")
    await asyncio.sleep(0.3)
    print()
    print(f"  {BOLD}{AMBER}[payload]{RESET} {STEEL}recurrent{RESET}  "
          f"{DIM}exploit/reentrant_drain.bin{RESET}  {GRAY}sha256:11fe…9a02{RESET}")
    await asyncio.sleep(0.3)
    print()

    # phase 1 — deposit seed to pass pre-conditions (may revert, fine)
    await publisher.victim_deposit(amount_wei=int(5 * 10 ** 19), gas_price=28)
    await spinner_stage(
        f"  {BOLD}[1/3]{RESET}  {STEEL}seed deposit           :: collateral{RESET}",
        duration=0.55,
        result=f"{GREEN}sent{RESET}",
    )

    # phase 2 — rapid borrows (the "re-entry" signal)
    print(f"  {BOLD}[2/3]{RESET}  {STEEL}recursive borrow cascade :: 6 × borrow(){RESET}")
    for i in range(6):
        await publisher.victim_borrow(amount_wei=int(2 * 10 ** 19),
                                      gas_price=34 + i * 3)
        if i == 2:
            print(f"         {DIM}{GRAY}└─{RESET}  {AMBER}re-entry {i + 1}/6{RESET}  "
                  f"{DIM}{GRAY}state not yet written{RESET}")
        await asyncio.sleep(0.12)
    print(f"         {DIM}{GRAY}└─{RESET}  {AMBER}6/6 callbacks fired{RESET}  "
          f"{DIM}{GRAY}call stack depth 6{RESET}")
    await asyncio.sleep(0.25)

    # phase 3 — exploit confirm
    await publisher.attack(loan_amount_wei=int(4 * 10 ** 20), gas_price=78)
    await progress_bar_stage(
        header=f"  {BOLD}[3/3]{RESET}  {RED}attack(address,uint256){RESET}",
        duration=0.9,
        colour=RED,
        final="blocked",
    )

    failure_footer(
        eoa=publisher.attacker_address,
        note="selector-repetition burst on victim pool tripped anomaly model.",
    )
    await publisher.aclose()
    return 0
