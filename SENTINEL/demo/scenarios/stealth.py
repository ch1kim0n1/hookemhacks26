"""stealth — surgical, minimum-footprint direct exploit.

Characteristics:
    • No recon banner. No cover transactions. No flash loan.
    • Attacker skips the ramp and fires the exploit selector cold.
    • Low gas — tries to blend with background traffic.
    • Runtime ≈ 10s.
    • Still caught: the detection state machine's direct-exploit branch
      transitions IDLE → CONFIRMED at 0.9 confidence the moment the
      attack selector hits. No multi-stage sequence required.
"""
from __future__ import annotations

import asyncio

from .._common import (
    AMBER, BOLD, DIM, GRAY, GREEN, RED, RESET, STEEL,
    TARGETS,
    Publisher, failure_footer, opcode_banner,
    progress_bar_stage, recon_line, spinner_stage,
)

OPCODE = "op-0404"
TITLE = "surgical direct exploit"
LABEL = "stealth"
DESCRIPTION = "minimum-footprint direct exploit call"
DURATION = "~10s"
STAGES = "1 stage"
PROFILE = "signature-alone"


async def run(publisher: Publisher) -> int:
    opcode_banner(OPCODE, TITLE)

    # minimal pre-flight — one line each, crisp
    recon_line("silo", f"entry point      {STEEL}{TARGETS['attacker_contract'][:10]}…{TARGETS['attacker_contract'][-4:]}{RESET}")
    await asyncio.sleep(0.15)
    recon_line("silo", f"gas profile      {GREEN}14 gwei · background-blend{RESET}")
    await asyncio.sleep(0.15)
    recon_line("silo", f"footprint        {STEEL}single transaction{RESET}")
    await asyncio.sleep(0.25)
    print()
    print(f"  {BOLD}{AMBER}[payload]{RESET} {STEEL}armed{RESET}  "
          f"{DIM}exploit/cold_call.bin{RESET}  {GRAY}sha256:d71c…9f42{RESET}")
    await asyncio.sleep(0.4)
    print()

    # one-shot exploit call, low gas, no pre-stages
    await publisher.attack(gas_price=14)

    await spinner_stage(
        f"  {BOLD}[1/1]{RESET}  {RED}attack(address,uint256){RESET}  {DIM}cold-cast{RESET}",
        duration=0.9,
        result=f"{AMBER}broadcast{RESET}",
    )

    await progress_bar_stage(
        header=f"  {DIM}{GRAY}└─ propagating{RESET}",
        duration=0.8,
        colour=RED,
        final="blocked",
    )

    failure_footer(
        eoa=publisher.attacker_address,
        note="selector signature alone cleared confirmation threshold.",
    )
    await publisher.aclose()
    return 0
