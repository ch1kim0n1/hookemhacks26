"""blitz — loud, fast, textbook flash-loan oracle manipulation.

Characteristics:
    • No patience. Full recon banner, then four stages back-to-back.
    • High gas — attacker pays for priority.
    • Runtime ≈ 20s.
    • Behaviour that lights every detection signal at once.
"""
from __future__ import annotations

import asyncio

from .._common import (
    AMBER, BOLD, DIM, GRAY, GREEN, RED, RESET, STEEL,
    TARGETS,
    Publisher, failure_footer, opcode_banner,
    progress_bar_stage, recon_line, spinner_stage,
)

OPCODE = "op-7741"
TITLE = "flash-loan oracle manipulation"
LABEL = "blitz"
DESCRIPTION = "loud, textbook flash-loan oracle manipulation"
DURATION = "~20s"
STAGES = "4 stages"
PROFILE = "maximum drama"


async def recon() -> None:
    recon_line("recon", f"resolving target  {STEEL}{TARGETS['victim_pool'][:10]}…{TARGETS['victim_pool'][-4:]}{RESET}")
    await asyncio.sleep(0.18)
    recon_line("recon", f"mempool depth     {AMBER}47,291 pending{RESET}")
    await asyncio.sleep(0.18)
    recon_line("recon", f"oracle reserves   {STEEL}1,247,000 WETH  /  3,891,420 USDC{RESET}")
    await asyncio.sleep(0.18)
    recon_line("recon", f"gas conditions    {GREEN}23 gwei  optimal{RESET}")
    await asyncio.sleep(0.18)
    recon_line("recon", f"flash liquidity   {GREEN}verified{RESET}")
    await asyncio.sleep(0.3)
    print()
    print(f"  {BOLD}{RED}[payload]{RESET} {STEEL}loaded{RESET}  "
          f"{DIM}exploit/flash_oracle_manip.bin{RESET}  {GRAY}sha256:4f9a…c71d{RESET}")
    await asyncio.sleep(0.4)
    print()


async def run(publisher: Publisher) -> int:
    opcode_banner(OPCODE, TITLE)
    await recon()

    # stage 1 — flash loan
    await publisher.flash_loan(amount_wei=10 ** 21, gas_price=45)
    await spinner_stage(
        f"  {BOLD}[1/4]{RESET}  {STEEL}borrow 1,000 WETH  :: flash-loan{RESET}",
        duration=0.85,
        result=f"{GREEN}sent{RESET}",
    )

    # stage 2 — oracle slam
    await publisher.oracle_swap(amount_wei=int(5 * 10 ** 20), gas_price=52)
    await spinner_stage(
        f"  {BOLD}[2/4]{RESET}  {STEEL}slam oracle reserves   :: swap{RESET}",
        duration=0.75,
        result=f"{GREEN}sent{RESET}",
        detail=f"deviation {RED}47.3%{RESET}",
    )

    # stage 3 — cover transfers (fills LSTM 5-tx window)
    await publisher.cover_transfer(gas_price=48)
    await publisher.cover_transfer(gas_price=49)
    await spinner_stage(
        f"  {BOLD}[3/4]{RESET}  {STEEL}chain cover transactions{RESET}",
        duration=0.45,
        result=f"{GREEN}sent{RESET}",
    )

    # stage 4 — exploit call (progress bar that ends in BLOCKED)
    await publisher.attack(loan_amount_wei=10 ** 21, gas_price=89)
    await progress_bar_stage(
        header=f"  {BOLD}[4/4]{RESET}  {RED}attack(address,uint256){RESET}",
        duration=0.9,
        colour=RED,
        final="blocked",
    )

    failure_footer(eoa=publisher.attacker_address)
    await publisher.aclose()
    return 0
