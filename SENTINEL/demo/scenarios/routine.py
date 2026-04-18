"""routine — benign baseline.

Normal on-chain activity from a plain EOA. No exploit selector, no flash
loan, no oracle manipulation. A single LP-style deposit plus one small
organic swap.

The point of this scenario in a demo: prove the system doesn't false-
positive. Expected outcome is **no** ThreatConfirmedEvent; at most a
`noise` classification. If the banner stays quiet while this runs,
that's the success state — a contrast scenario you fire *before* the
attack scenarios to show green-field behaviour.

Characteristics:
    • One deposit, one modest swap, one transfer. That's it.
    • Low gas, relaxed pacing.
    • Runtime ≈ 8s.
    • Detection: should stay idle. No `attack()` selector, no flash-loan origin.
"""
from __future__ import annotations

import asyncio

from .._common import (
    AMBER, BOLD, DIM, GRAY, GREEN, RED, RESET, STEEL,
    Publisher, failure_footer, opcode_banner,
    progress_bar_stage, recon_line, spinner_stage,
    RULE, line,
)

OPCODE = "op-bn00"
TITLE = "routine on-chain activity · baseline"
LABEL = "routine"
DESCRIPTION = "benign lp + swap · no exploit, no confirmation"
DURATION = "~8s"
STAGES = "3 stages"
PROFILE = "green-field baseline"


async def run(publisher: Publisher) -> int:
    opcode_banner(OPCODE, TITLE)

    recon_line("prep", f"wallet posture         {STEEL}normal eoa · no flash-loan history{RESET}")
    await asyncio.sleep(0.2)
    recon_line("prep", f"target                 {STEEL}victim-pool · open market{RESET}")
    await asyncio.sleep(0.2)
    recon_line("prep", f"intent                 {GREEN}lp deposit · one swap{RESET}")
    await asyncio.sleep(0.3)
    print()

    # stage 1 — deposit
    await publisher.victim_deposit(amount_wei=int(2 * 10 ** 19), gas_price=23)
    await spinner_stage(
        f"  {BOLD}[1/3]{RESET}  {STEEL}lp deposit              :: deposit(usdc){RESET}",
        duration=0.7,
        result=f"{GREEN}confirmed{RESET}",
    )

    # stage 2 — small organic swap
    await publisher.oracle_swap(amount_wei=int(5 * 10 ** 18), gas_price=24)
    await spinner_stage(
        f"  {BOLD}[2/3]{RESET}  {STEEL}small swap              :: 0.005 WETH{RESET}",
        duration=0.7,
        result=f"{GREEN}confirmed{RESET}",
        detail="deviation 0.02%",
    )

    # stage 3 — a polite transfer
    await publisher.cover_transfer(amount=1, gas_price=22)
    await spinner_stage(
        f"  {BOLD}[3/3]{RESET}  {STEEL}token transfer          :: transfer(){RESET}",
        duration=0.6,
        result=f"{GREEN}confirmed{RESET}",
    )

    # Explicit success footer instead of the failure_footer — this scenario
    # is supposed to NOT trigger the defender's red banner.
    print()
    print(RULE)
    line(f"{BOLD}{GREEN}  nominal activity complete.{RESET}", 0.015)
    line(f"{GRAY}  detector should remain at {GREEN}noise{GRAY}/{GREEN}idle{GRAY}."
         f" no threat confirmed.{RESET}", 0.004)
    line(f"{GRAY}  eoa {publisher.attacker_address[:10]}…{publisher.attacker_address[-4:]} "
         f"stays off the threat-registry.{RESET}", 0.004)
    print(RULE)

    await publisher.aclose()
    return 0
