"""recon — patient, intel-heavy approach.

Characteristics:
    • Extended reconnaissance: enumerates roles, probes reserves, warms pools.
    • Uses two sybil EOAs for cover before the primary attack.
    • Slower pacing between stages (attacker believes patience = invisibility).
    • Runtime ≈ 40s.
    • Defender sees a long ramp of suspicious observations before the kill shot.
"""
from __future__ import annotations

import asyncio

from .._common import (
    AMBER, BOLD, DIM, GRAY, GREEN, RED, RESET, STEEL,
    SYBIL_EOA_A, SYBIL_EOA_B,
    Publisher, failure_footer, opcode_banner,
    progress_bar_stage, recon_line, spinner_stage,
)

OPCODE = "op-2319"
TITLE = "patient reconnaissance · oracle manipulation"
LABEL = "recon"
DESCRIPTION = "patient intel-gathering approach"
DURATION = "~40s"
STAGES = "8 signals"
PROFILE = "sybil cover"


async def deep_recon(publisher: Publisher) -> None:
    recon_line("recon", f"enumerating admin roles       {STEEL}owner · pauser · guardian{RESET}")
    await asyncio.sleep(0.35)
    recon_line("recon", f"fingerprint oracle cadence    {STEEL}twap-300s / post-block{RESET}")
    await asyncio.sleep(0.35)
    recon_line("recon", f"map delegatecall surface      {AMBER}7 reachable proxies{RESET}")
    await asyncio.sleep(0.35)
    recon_line("recon", f"provision sybil eoas          {STEEL}{SYBIL_EOA_A[:8]}… / {SYBIL_EOA_B[:8]}…{RESET}")
    await asyncio.sleep(0.35)
    recon_line("recon", f"warm cold pools               {GREEN}3 / 3 primed{RESET}")
    await asyncio.sleep(0.35)
    recon_line("recon", f"frontrun shield               {GREEN}armed{RESET}")
    await asyncio.sleep(0.4)
    print()

    # publish some low-profile probe txs during recon
    await publisher.probe_reserves(frm=SYBIL_EOA_A, gas_price=19)
    await spinner_stage(
        f"  {GRAY}[probe]{RESET} {STEEL}read oracle reserves    :: getReserves(){RESET}",
        duration=0.6, result=f"{GREEN}ok{RESET}",
        detail=f"sybil {SYBIL_EOA_A[:10]}…",
    )

    await publisher.probe_balance(frm=SYBIL_EOA_B, gas_price=18)
    await spinner_stage(
        f"  {GRAY}[probe]{RESET} {STEEL}query victim balance    :: balanceOf(){RESET}",
        duration=0.6, result=f"{GREEN}ok{RESET}",
        detail=f"sybil {SYBIL_EOA_B[:10]}…",
    )

    await publisher.approve_allowance(frm=SYBIL_EOA_A, amount_wei=10 ** 20, gas_price=22)
    await spinner_stage(
        f"  {GRAY}[probe]{RESET} {STEEL}pre-approve allowance   :: approve(){RESET}",
        duration=0.6, result=f"{GREEN}ok{RESET}",
    )

    print()
    print(f"  {BOLD}{AMBER}[payload]{RESET} {STEEL}staged{RESET}  "
          f"{DIM}exploit/silent_drain.bin{RESET}  {GRAY}sha256:8e2c…a0b3{RESET}")
    await asyncio.sleep(0.6)
    print()


async def run(publisher: Publisher) -> int:
    opcode_banner(OPCODE, TITLE)
    await deep_recon(publisher)

    # stage 1 — flash loan, larger size, patient gas
    await publisher.flash_loan(amount_wei=int(25 * 10 ** 20), gas_price=32)
    await spinner_stage(
        f"  {BOLD}[1/5]{RESET}  {STEEL}borrow 2,500 WETH  :: flash-loan{RESET}",
        duration=1.1,
        result=f"{GREEN}sent{RESET}",
        detail="stealth gas 32gwei",
    )

    # stage 2 — pre-swap nudge (small, looks organic)
    await publisher.oracle_swap(amount_wei=int(3 * 10 ** 19), gas_price=33)
    await spinner_stage(
        f"  {BOLD}[2/5]{RESET}  {STEEL}nudge pair reserves    :: swap{RESET}",
        duration=0.9,
        result=f"{GREEN}sent{RESET}",
        detail=f"deviation {AMBER}3.1%{RESET}",
    )

    # stage 3 — primary oracle slam
    await publisher.oracle_swap(amount_wei=int(22 * 10 ** 20), gas_price=41)
    await spinner_stage(
        f"  {BOLD}[3/5]{RESET}  {STEEL}slam oracle reserves   :: swap{RESET}",
        duration=0.9,
        result=f"{GREEN}sent{RESET}",
        detail=f"deviation {RED}62.8%{RESET}",
    )

    # stage 4 — chained cover (fills LSTM window with same EOA)
    for _ in range(2):
        await publisher.cover_transfer(gas_price=34)
    await spinner_stage(
        f"  {BOLD}[4/5]{RESET}  {STEEL}chain cover transactions{RESET}",
        duration=0.55,
        result=f"{GREEN}sent{RESET}",
        detail="2 transfers",
    )

    # stage 5 — exploit call
    await publisher.attack(gas_price=71)
    await progress_bar_stage(
        header=f"  {BOLD}[5/5]{RESET}  {RED}attack(address,uint256){RESET}",
        duration=1.1,
        colour=RED,
        final="blocked",
    )

    failure_footer(
        eoa=publisher.attacker_address,
        note="eight signals correlated — long window exposed full kill-chain.",
    )
    await publisher.aclose()
    return 0
