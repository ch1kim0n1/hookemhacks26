"""sandwich — MEV front-run / back-run.

Classic sandwich: attacker spots a pending victim swap, front-runs it with
a same-direction swap to move the price, lets the victim get worse
execution, then back-runs with a reverse swap to pocket the slippage.
Ends with the attack selector to anchor confirmation.

Characteristics:
    • Three oracle-pair swaps in tight sequence around a "victim" tx.
    • Moderate gas — competing for block position.
    • Runtime ≈ 15s.
    • Detection fires on rapid same-pair swap cadence + deviation.
"""
from __future__ import annotations

import asyncio

from .._common import (
    AMBER, BOLD, DIM, GRAY, GREEN, RED, RESET, STEEL,
    Publisher, failure_footer, opcode_banner,
    progress_bar_stage, recon_line, spinner_stage,
)

OPCODE = "op-mev1"
TITLE = "mempool sandwich · mev extraction"
LABEL = "sandwich"
DESCRIPTION = "classic mev sandwich around a victim swap"
DURATION = "~15s"
STAGES = "4 stages"
PROFILE = "mev / slippage capture"


async def run(publisher: Publisher) -> int:
    opcode_banner(OPCODE, TITLE)

    recon_line("scan", f"observing mempool      {STEEL}victim swap queued · 42 USDC → WETH{RESET}")
    await asyncio.sleep(0.25)
    recon_line("scan", f"slippage setting       {AMBER}0.5%{RESET}")
    await asyncio.sleep(0.2)
    recon_line("scan", f"extract envelope       {GREEN}~ 3.2 bps / tx{RESET}")
    await asyncio.sleep(0.3)
    print()
    print(f"  {BOLD}{AMBER}[payload]{RESET} {STEEL}ready{RESET}  "
          f"{DIM}mev/sandwich_bundle.bin{RESET}  {GRAY}sha256:2c4e…71ab{RESET}")
    await asyncio.sleep(0.4)
    print()

    # stage 1 — front-run swap (moves price against victim)
    await publisher.oracle_swap(amount_wei=int(2 * 10 ** 20), gas_price=58)
    await spinner_stage(
        f"  {BOLD}[1/4]{RESET}  {STEEL}front-run swap         :: inflate price{RESET}",
        duration=0.55,
        result=f"{GREEN}sent{RESET}",
        detail="priority gas 58 gwei",
    )

    # stage 2 — simulated victim tx (dust transfer to represent them)
    await publisher.cover_transfer(gas_price=30)
    await spinner_stage(
        f"  {DIM}{GRAY}[2/4]{RESET}  {DIM}{GRAY}victim swap lands     :: worse execution{RESET}",
        duration=0.7,
        result=f"{DIM}{GRAY}mined{RESET}",
        detail=f"{DIM}slippage {RED}-0.5%{RESET}",
    )

    # stage 3 — back-run swap (reverse direction, capture the diff)
    await publisher.oracle_swap(amount_wei=int(2 * 10 ** 20), gas_price=56)
    await spinner_stage(
        f"  {BOLD}[3/4]{RESET}  {STEEL}back-run swap          :: deflate, extract{RESET}",
        duration=0.55,
        result=f"{GREEN}sent{RESET}",
    )

    # stage 4 — attack selector to anchor confirmation
    await publisher.attack(loan_amount_wei=10 ** 20, gas_price=72)
    await progress_bar_stage(
        header=f"  {BOLD}[4/4]{RESET}  {RED}attack(address,uint256){RESET}",
        duration=0.9,
        colour=RED,
        final="blocked",
    )

    failure_footer(
        eoa=publisher.attacker_address,
        note="mev pattern: same-pair swap cadence + selector anchored the verdict.",
    )
    await publisher.aclose()
    return 0
