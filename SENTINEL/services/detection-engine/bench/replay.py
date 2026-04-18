"""Replay a single HistoricalAttack through an Operator and time it."""
from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import Optional

from detection_engine.operator import Operator

from .attack_corpus import HistoricalAttack


@dataclass
class ReplayResult:
    attack_name: str
    loss_usd_millions: float
    caught: bool
    confidence_bp: int
    level: str
    latency_ms_flash_to_verdict: float
    latency_ms_exploit_tx: float
    observations: int


def _features_of(
    tx: dict, *, oracle_addr: str, attack_selector: str
) -> dict:
    selector = (tx.get("selector") or "").lower()
    to = (tx.get("to") or "").lower()
    return {
        "loan_amount_wei": tx.get("value", "0"),
        "price_deviation_pct": 0.0,
        "gas_price_gwei": float(tx.get("gasPrice", 20)),
        "is_known_selector": selector.endswith(attack_selector.lower()),
        "to_is_oracle": to == oracle_addr.lower(),
    }


def _run(op: Operator, tx: dict, atk: HistoricalAttack, deviation: float):
    return op.evaluate(
        tx,
        tx_hash=tx["hash"],
        tx_from=tx["from"],
        tx_features=_features_of(
            tx,
            oracle_addr=atk.oracle,
            attack_selector=atk.attack_selector_hex,
        ),
        flash_provider=atk.flash_provider,
        oracle_addr=atk.oracle,
        attacker_addr=atk.attacker_contract,
        attack_selector=atk.attack_selector_hex,
        price_deviation_getter=lambda _o, _v: deviation,
        victim_protocol=atk.victim_protocol,
        observed_at="2026-04-17T00:00:00Z",
    )


def replay_attack(
    op: Operator, atk: HistoricalAttack, *, rng: random.Random
) -> ReplayResult:
    """Drive the three-step kill-chain through the detector and time it."""
    tag = f"{atk.name}:{rng.randint(0, 2**32)}"
    flash_hash = f"0xf{hash(tag) & 0xfffffffffff:011x}"
    oracle_hash = f"0xa{hash(tag + 'o') & 0xfffffffffff:011x}"
    exploit_hash = f"0xe{hash(tag + 'e') & 0xfffffffffff:011x}"

    flash_tx = {
        "hash": flash_hash,
        "from": atk.attacker_eoa,
        "to": atk.flash_provider,
        "selector": "0xab9c4b5d",
        "value": str(atk.flash_loan_wei),
        "gasPrice": 45,
    }
    oracle_tx = {
        "hash": oracle_hash,
        "from": atk.attacker_eoa,
        "to": atk.oracle,
        "selector": "0x022c0d9f",
        "value": str(atk.flash_loan_wei // 2),
        "gasPrice": 52,
    }
    exploit_tx = {
        "hash": exploit_hash,
        "from": atk.attacker_eoa,
        "to": atk.attacker_contract,
        "selector": "0x" + atk.attack_selector_hex,
        "value": "0",
        "gasPrice": 89,
    }

    t0 = time.perf_counter()
    _run(op, flash_tx, atk, deviation=0.0)
    _run(op, oracle_tx, atk, deviation=atk.oracle_deviation_pct)
    t_pre = time.perf_counter()
    verdict = _run(op, exploit_tx, atk, deviation=atk.oracle_deviation_pct)
    t_after = time.perf_counter()

    caught = verdict is not None and verdict.level in {"candidate", "confirmed"}
    return ReplayResult(
        attack_name=atk.name,
        loss_usd_millions=atk.loss_usd_millions,
        caught=caught,
        confidence_bp=verdict.confidence_bp if verdict else 0,
        level=verdict.level if verdict else "miss",
        latency_ms_flash_to_verdict=(t_after - t0) * 1000,
        latency_ms_exploit_tx=(t_after - t_pre) * 1000,
        observations=verdict.observations if verdict else 0,
    )


def generate_benign_tx(rng: random.Random) -> dict:
    """Realistic ERC-20 transfer / swap traffic for FP measurement."""
    selectors = [
        "0xa9059cbb",  # transfer
        "0x23b872dd",  # transferFrom
        "0x095ea7b3",  # approve
        "0x38ed1739",  # swapExactTokensForTokens
        "0x7ff36ab5",  # swapExactETHForTokens
        "0x4a25d94a",  # swapTokensForExactETH
        "0x18cbafe5",  # swapExactTokensForETH
        "0xfb3bdb41",  # swapETHForExactTokens
    ]
    return {
        "hash": f"0xb{rng.randint(0, 2**48):012x}",
        "from": f"0x{rng.randint(0, 2**159):040x}",
        "to": f"0x{rng.randint(0, 2**159):040x}",
        "selector": rng.choice(selectors),
        "value": str(rng.randint(0, 10**20)),
        "gasPrice": rng.randint(10, 120),
    }


def replay_benign(op: Operator, n: int, *, rng: random.Random) -> dict:
    """Stream benign txs; count any that produce a non-noise verdict."""
    false_positives = 0
    t0 = time.perf_counter()
    # Use a stable, non-oracle non-flash-provider so state never advances.
    dummy_flash = "0x000000000000000000000000000000000000dead"
    dummy_oracle = "0x000000000000000000000000000000000000beef"
    dummy_attacker_contract = "0x000000000000000000000000000000000000cafe"
    for _ in range(n):
        tx = generate_benign_tx(rng)
        v = op.evaluate(
            tx,
            tx_hash=tx["hash"],
            tx_from=tx["from"],
            tx_features={
                "loan_amount_wei": tx["value"],
                "price_deviation_pct": 0.0,
                "gas_price_gwei": float(tx["gasPrice"]),
                "is_known_selector": False,
                "to_is_oracle": False,
            },
            flash_provider=dummy_flash,
            oracle_addr=dummy_oracle,
            attacker_addr=dummy_attacker_contract,
            attack_selector="deadbeef",
            price_deviation_getter=lambda _o, _v: 0.0,
            victim_protocol="0x0000000000000000000000000000000000000000",
            observed_at="2026-04-17T00:00:00Z",
        )
        if v is not None and v.level != "noise":
            false_positives += 1
    elapsed = (time.perf_counter() - t0) * 1000
    return {
        "n": n,
        "false_positives": false_positives,
        "fp_rate": false_positives / max(1, n),
        "elapsed_ms": elapsed,
        "ms_per_tx": elapsed / max(1, n),
    }


def make_operator(seed: int = 1337) -> Operator:
    """Fresh Operator warmed up once per benchmark run."""
    op = Operator(operator_id="alpha", seed=seed)
    op.warm_up(n_normal=300, n_attack=200, n_seq_normal=400)
    return op
