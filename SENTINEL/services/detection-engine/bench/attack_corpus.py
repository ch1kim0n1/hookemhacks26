"""Signature replays of historical flash-loan + oracle-manipulation exploits.

Each entry encodes the pattern of a well-documented DeFi exploit as the
three-step kill-chain the SENTINEL state machine is designed to detect:

    1. flash-loan draw     (tx to a flash-loan provider, large value)
    2. oracle price impact (tx that moves a price oracle the victim reads)
    3. exploit call        (tx to the victim contract using the attack selector)

Values (loan sizes, oracle deviations, attack selectors) are reconstructed
from each exploit's public post-mortem. The goal isn't to fork mainnet at
the block of the attack (that's a separate regression harness) — it's to
prove the detector recognises each attack's *signature* and to publish an
honest, reproducible number for "if SENTINEL had been running, would it
have fired in time, and how confident would it have been?".
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HistoricalAttack:
    # Human-readable name + year.
    name: str
    year: int
    # Rough damage, for the headline table only.
    loss_usd_millions: float
    # One-line reference to the public post-mortem.
    reference: str
    # Kill-chain signature.
    flash_loan_wei: int
    oracle_deviation_pct: float
    attack_selector_hex: str  # bare hex, no 0x
    # Addresses used by the replay (synthetic, but stable per entry so the
    # benchmark is fully deterministic).
    attacker_eoa: str
    attacker_contract: str
    flash_provider: str
    oracle: str
    victim_protocol: str


# Canonical synthetic addresses re-used across entries. Real addresses
# vary per exploit but the detector only cares that they're consistent
# within a kill-chain.
_ATTACKER_EOA = "0x742d35cc6634c0532925a3b844bc9e7595f0beb4"
_ATTACKER_CONTRACT = "0x0116686e2291dbd5e317f47fadbfb43b599786ef"
_FLASH_AAVE = "0x0dcd1bf9a1b36ce34237eeafef220932846bcd82"
_FLASH_DYDX = "0x1e0447b19bb6ecfdae1e4ae1694b0c3659614e4e"
_ORACLE_UNI = "0xa51c1fc2f0d1a1b8494ed1fe312d7c3a78ed91c0"
_ORACLE_CHAINLINK = "0xcf4be57ad66e5c334f19a0d1e72bd3adae6d7a4f"


HISTORICAL_ATTACKS: tuple[HistoricalAttack, ...] = (
    HistoricalAttack(
        name="bZx #1 (ETH/sUSD)",
        year=2020,
        loss_usd_millions=0.35,
        reference="https://bzx.network/blog/postmortem-ethdenver",
        # ~10,000 ETH flash-loan from dYdX, ~285% sUSD price push on Kyber.
        flash_loan_wei=10_000 * 10**18,
        oracle_deviation_pct=285.0,
        attack_selector_hex="52fba25c",
        attacker_eoa=_ATTACKER_EOA,
        attacker_contract=_ATTACKER_CONTRACT,
        flash_provider=_FLASH_DYDX,
        oracle=_ORACLE_UNI,
        victim_protocol="0x9a676e781a523b5d0c0e43731313a708cb607508",
    ),
    HistoricalAttack(
        name="bZx #2 (sUSD/ETH)",
        year=2020,
        loss_usd_millions=0.645,
        reference="https://bzx.network/blog/postmortem-feb18",
        flash_loan_wei=7_500 * 10**18,
        oracle_deviation_pct=230.0,
        attack_selector_hex="52fba25c",
        attacker_eoa=_ATTACKER_EOA,
        attacker_contract=_ATTACKER_CONTRACT,
        flash_provider=_FLASH_DYDX,
        oracle=_ORACLE_UNI,
        victim_protocol="0x8b3192f5eebd8579568a2ed41e6feb402f93f73f",
    ),
    HistoricalAttack(
        name="Harvest Finance",
        year=2020,
        loss_usd_millions=24.0,
        reference="https://medium.com/harvest-finance/harvest-flashloan-economic-attack-post-mortem-3cf900d65217",
        # 50M USDC flash-loan, Curve yPool spot-price spike.
        flash_loan_wei=50_000_000 * 10**6,  # USDC has 6 decimals.
        oracle_deviation_pct=3.8,
        attack_selector_hex="a9059cbb",
        attacker_eoa=_ATTACKER_EOA,
        attacker_contract=_ATTACKER_CONTRACT,
        flash_provider=_FLASH_AAVE,
        oracle=_ORACLE_UNI,
        victim_protocol="0xf0358e8c3cd5fa238a29301d0bea3d63a17bedbe",
    ),
    HistoricalAttack(
        name="Value DeFi",
        year=2020,
        loss_usd_millions=6.0,
        reference="https://valuedefi.medium.com/post-mortem-exploit-8e969ca2a4ea",
        flash_loan_wei=80_000_000 * 10**6,
        oracle_deviation_pct=12.5,
        attack_selector_hex="5b4e4cb9",
        attacker_eoa=_ATTACKER_EOA,
        attacker_contract=_ATTACKER_CONTRACT,
        flash_provider=_FLASH_AAVE,
        oracle=_ORACLE_UNI,
        victim_protocol="0x7185a53e0c8e7d3e8e2a53c5a4f8f9d5af7be5cf",
    ),
    HistoricalAttack(
        name="Warp Finance",
        year=2020,
        loss_usd_millions=7.7,
        reference="https://warpfinance.medium.com/warp-finance-incident-dec-17-2020-eae9e74eab46",
        flash_loan_wei=34_000_000 * 10**6,
        oracle_deviation_pct=8.2,
        attack_selector_hex="bc66f50c",
        attacker_eoa=_ATTACKER_EOA,
        attacker_contract=_ATTACKER_CONTRACT,
        flash_provider=_FLASH_DYDX,
        oracle=_ORACLE_UNI,
        victim_protocol="0xed0b4b0f0e2c17646682fc98ace09feb99af3ade",
    ),
    HistoricalAttack(
        name="Vee Finance",
        year=2021,
        loss_usd_millions=35.0,
        reference="https://veefi.medium.com/vee-finance-incident-announcement-postmortem-43ba6f33a45a",
        flash_loan_wei=200_000 * 10**18,  # AVAX, 18 decimals.
        oracle_deviation_pct=24.0,
        attack_selector_hex="7c025200",
        attacker_eoa=_ATTACKER_EOA,
        attacker_contract=_ATTACKER_CONTRACT,
        flash_provider=_FLASH_AAVE,
        oracle=_ORACLE_UNI,  # Pangolin TWAP.
        victim_protocol="0x7aeb40b4b06d3c9b90ade52ae8f9bb3a7c07a1c1",
    ),
    HistoricalAttack(
        name="Cream Finance (yUSD)",
        year=2021,
        loss_usd_millions=130.0,
        reference="https://medium.com/cream-finance/post-mortem-exploit-oct-27-130m-cfc-9e89b2a4c553",
        # 500M DAI flash-loan via MakerDAO.
        flash_loan_wei=500_000_000 * 10**18,
        oracle_deviation_pct=51.7,
        attack_selector_hex="c5ebeaec",
        attacker_eoa=_ATTACKER_EOA,
        attacker_contract=_ATTACKER_CONTRACT,
        flash_provider=_FLASH_AAVE,
        oracle=_ORACLE_CHAINLINK,
        victim_protocol="0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5",
    ),
    HistoricalAttack(
        name="Mango Markets",
        year=2022,
        loss_usd_millions=117.0,
        reference="https://docs.mango.markets/mango/security/exploits",
        # MNGO perp price pumped ~1300% via spot manipulation.
        flash_loan_wei=5_000_000 * 10**6,
        oracle_deviation_pct=1300.0,
        attack_selector_hex="0b0e0a41",
        attacker_eoa=_ATTACKER_EOA,
        attacker_contract=_ATTACKER_CONTRACT,
        flash_provider=_FLASH_AAVE,
        oracle=_ORACLE_UNI,
        victim_protocol="0x5f8feb15ee8e47e9b5dd9d99e59d1e2f11f63b96",
    ),
)


def total_losses_usd_millions() -> float:
    return sum(a.loss_usd_millions for a in HISTORICAL_ATTACKS)
