"""pingflood — oracle TWAP bias via high-frequency micro-swaps.

Attacker floods the oracle pair with dozens of small swaps, aiming to
skew the time-weighted average before the real exploit call. Each swap
alone looks tiny and innocuous; the cadence is the signal.

Characteristics:
    • 20+ oracle-pair swaps in rapid bursts (no sleeps longer than 150ms).
    • Low-to-moderate gas — tries to blend with organic activity.
    • Runtime ≈ 25s.
    • Detection fires on deviation velocity + high-frequency same-pair pattern.
"""
from __future__ import annotations

import asyncio

from .._common import (
    AMBER, BOLD, DIM, GRAY, GREEN, RED, RESET, STEEL,
    Publisher, failure_footer, opcode_banner,
    progress_bar_stage, recon_line, spinner_stage,
)

OPCODE = "op-pf22"
TITLE = "oracle ping-flood · twap bias"
LABEL = "pingflood"
DESCRIPTION = "high-frequency micro-swap flood to bias twap"
DURATION = "~25s"
STAGES = "3 phases"
PROFILE = "cadence-based bias"

PULSE_COUNT = 18


async def run(publisher: Publisher) -> int:
    opcode_banner(OPCODE, TITLE)

    recon_line("dial", f"twap window            {STEEL}300s rolling{RESET}")
    await asyncio.sleep(0.2)
    recon_line("dial", f"pulse amplitude        {STEEL}0.02 ETH · imperceptible{RESET}")
    await asyncio.sleep(0.2)
    recon_line("dial", f"target bias            {AMBER}+1.4% twap drift{RESET}")
    await asyncio.sleep(0.2)
    recon_line("dial", f"gas posture            {GREEN}17-22 gwei · organic-shape{RESET}")
    await asyncio.sleep(0.3)
    print()
    print(f"  {BOLD}{AMBER}[payload]{RESET} {STEEL}flooding{RESET}  "
          f"{DIM}mev/twap_bias_pulse.bin{RESET}  {GRAY}sha256:7d8f…c304{RESET}")
    await asyncio.sleep(0.3)
    print()

    # phase 1 — warm-up burst
    header = f"  {BOLD}[1/3]{RESET}  {STEEL}warm-up burst          :: 6 × micro-swap{RESET}"
    print(header)
    for i in range(6):
        await publisher.oracle_swap(amount_wei=int(2 * 10 ** 16), gas_price=17 + (i % 3))
        await asyncio.sleep(0.12)
    print(f"         {DIM}{GRAY}└─{RESET}  {GREEN}6 sent{RESET}  "
          f"{DIM}{GRAY}avg gas 18 gwei{RESET}")
    await asyncio.sleep(0.25)

    # phase 2 — sustained ping
    header = f"  {BOLD}[2/3]{RESET}  {STEEL}sustained ping flood   :: 12 × micro-swap{RESET}"
    print(header)
    for i in range(PULSE_COUNT - 6):
        await publisher.oracle_swap(amount_wei=int(3 * 10 ** 16), gas_price=19 + (i % 4))
        await asyncio.sleep(0.09)
    print(f"         {DIM}{GRAY}└─{RESET}  {GREEN}12 sent{RESET}  "
          f"{DIM}{GRAY}twap drift {AMBER}+1.1%{RESET}")
    await asyncio.sleep(0.3)

    # phase 3 — exploit call on the biased price
    await publisher.attack(loan_amount_wei=int(5 * 10 ** 20), gas_price=63)
    await progress_bar_stage(
        header=f"  {BOLD}[3/3]{RESET}  {RED}attack(address,uint256){RESET}",
        duration=1.0,
        colour=RED,
        final="blocked",
    )

    failure_footer(
        eoa=publisher.attacker_address,
        note="18 micro-pulses + selector — cadence plus signature tipped confidence.",
    )
    await publisher.aclose()
    return 0
