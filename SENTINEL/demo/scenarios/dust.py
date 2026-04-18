"""dust — dust-storm evasion attempt.

Attacker floods the mempool with tiny token transfers hoping to desensitize
the anomaly model's feature distributions. The theory: push so much low-
signal noise that the real exploit looks like just-another-tiny-tx.

In practice the LSTM sequence score + state machine punch through the
noise; the attack call at the end still fires CONFIRMED.

Characteristics:
    • 25+ dust ERC20 transfers at consistent small amounts.
    • Uniform low gas — tries to look like one bot batch-transferring.
    • Runtime ≈ 30s.
    • Detection rides anomaly.freq signal, not per-tx severity.
"""
from __future__ import annotations

import asyncio

from .._common import (
    AMBER, BOLD, DIM, GRAY, GREEN, RED, RESET, STEEL,
    Publisher, failure_footer, opcode_banner,
    progress_bar_stage, recon_line, spinner_stage,
)

OPCODE = "op-ds08"
TITLE = "dust-storm evasion · distribution poisoning"
LABEL = "dust"
DESCRIPTION = "mempool flood to desensitize anomaly detector"
DURATION = "~30s"
STAGES = "2 phases"
PROFILE = "distribution poisoning"

DUST_COUNT = 25


async def run(publisher: Publisher) -> int:
    opcode_banner(OPCODE, TITLE)

    recon_line("mist", f"target feature axis    {STEEL}tx-volume · gas-quantile{RESET}")
    await asyncio.sleep(0.2)
    recon_line("mist", f"noise amplitude        {STEEL}1 wei · uniform{RESET}")
    await asyncio.sleep(0.2)
    recon_line("mist", f"emission cadence       {AMBER}120ms{RESET}")
    await asyncio.sleep(0.2)
    recon_line("mist", f"hypothesis             {DIM}detector desensitizes inside 5-tx window{RESET}")
    await asyncio.sleep(0.3)
    print()
    print(f"  {BOLD}{AMBER}[payload]{RESET} {STEEL}streaming{RESET}  "
          f"{DIM}evasion/dust_sweep.bin{RESET}  {GRAY}sha256:a9c1…ff80{RESET}")
    await asyncio.sleep(0.3)
    print()

    # phase 1 — dust storm
    print(f"  {BOLD}[1/2]{RESET}  {STEEL}dust storm             :: {DUST_COUNT} × micro-transfer{RESET}")
    for i in range(DUST_COUNT):
        await publisher.cover_transfer(amount=1, gas_price=12 + (i % 2))
        # Every 5 dust txs, print a crumb so the audience sees activity.
        if (i + 1) % 5 == 0:
            print(f"         {DIM}{GRAY}└─{RESET}  {GRAY}{i + 1:>2}/{DUST_COUNT} sent{RESET}  "
                  f"{DIM}{GRAY}distribution drift {AMBER}+{(i + 1) * 0.3:.1f}σ{RESET}")
        await asyncio.sleep(0.08)
    await asyncio.sleep(0.3)

    # phase 2 — the real exploit, betting on desensitization
    await publisher.attack(loan_amount_wei=int(8 * 10 ** 20), gas_price=58)
    await progress_bar_stage(
        header=f"  {BOLD}[2/2]{RESET}  {RED}attack(address,uint256){RESET}  {DIM}post-desensitization{RESET}",
        duration=1.0,
        colour=RED,
        final="blocked",
    )

    failure_footer(
        eoa=publisher.attacker_address,
        note="dust flood shifted feature distribution; selector still matched the kill rule.",
    )
    await publisher.aclose()
    return 0
