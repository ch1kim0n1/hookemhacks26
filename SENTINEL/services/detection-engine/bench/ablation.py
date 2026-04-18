"""Paired historical-exploit benchmark: runs the 8-attack corpus twice,
once with the full feature set, once with `is_known_selector` forced
to False. Reports catch-rate and false-positive rate for each.

Purpose: honestly publish how much of the 100% detection rate is
carried by the ML signal vs the hardcoded selector-match flag. A
high catch rate in both runs = ML generalises; a collapse in the
ablated run = we're doing signature matching with ML garnish. We
report both numbers so judges can calibrate."""
from __future__ import annotations

import json
import random
import statistics
import time
from typing import Any

from detection_engine.operator import Operator

from .attack_corpus import HISTORICAL_ATTACKS, HistoricalAttack
from .replay import generate_benign_tx, make_operator


def _features(tx: dict, *, oracle_addr: str, attack_selector: str, force_unknown_selector: bool) -> dict:
    selector = (tx.get("selector") or "").lower()
    to = (tx.get("to") or "").lower()
    return {
        "loan_amount_wei": tx.get("value", "0"),
        "price_deviation_pct": 0.0,
        "gas_price_gwei": float(tx.get("gasPrice", 20)),
        "is_known_selector": (
            False
            if force_unknown_selector
            else selector.endswith(attack_selector.lower())
        ),
        "to_is_oracle": to == oracle_addr.lower(),
    }


def _drive(
    op: Operator, atk: HistoricalAttack, rng: random.Random, *, force_unknown_selector: bool
) -> dict[str, Any]:
    tag = f"{atk.name}:{rng.randint(0, 2**32)}"
    flash_hash = f"0xf{hash(tag) & 0xfffffffffff:011x}"
    oracle_hash = f"0xa{hash(tag + 'o') & 0xfffffffffff:011x}"
    exploit_hash = f"0xe{hash(tag + 'e') & 0xfffffffffff:011x}"
    flash_tx = {
        "hash": flash_hash, "from": atk.attacker_eoa, "to": atk.flash_provider,
        "selector": "0xab9c4b5d", "value": str(atk.flash_loan_wei), "gasPrice": 45,
    }
    oracle_tx = {
        "hash": oracle_hash, "from": atk.attacker_eoa, "to": atk.oracle,
        "selector": "0x022c0d9f", "value": str(atk.flash_loan_wei // 2), "gasPrice": 52,
    }
    exploit_tx = {
        "hash": exploit_hash, "from": atk.attacker_eoa, "to": atk.attacker_contract,
        "selector": "0x" + atk.attack_selector_hex, "value": "0", "gasPrice": 89,
    }

    def run_one(tx: dict, deviation: float):
        return op.evaluate(
            tx,
            tx_hash=tx["hash"],
            tx_from=tx["from"],
            tx_features=_features(
                tx,
                oracle_addr=atk.oracle,
                attack_selector=atk.attack_selector_hex,
                force_unknown_selector=force_unknown_selector,
            ),
            flash_provider=atk.flash_provider,
            oracle_addr=atk.oracle,
            attacker_addr=atk.attacker_contract,
            attack_selector=atk.attack_selector_hex,
            price_deviation_getter=lambda _o, _v: deviation,
            victim_protocol=atk.victim_protocol,
            observed_at="2026-04-17T00:00:00Z",
        )

    t0 = time.perf_counter()
    run_one(flash_tx, 0.0)
    run_one(oracle_tx, atk.oracle_deviation_pct)
    t_pre = time.perf_counter()
    verdict = run_one(exploit_tx, atk.oracle_deviation_pct)
    t_after = time.perf_counter()

    caught = verdict is not None and verdict.level in {"candidate", "confirmed"}
    return {
        "name": atk.name,
        "caught": caught,
        "confidence_bp": verdict.confidence_bp if verdict else 0,
        "level": verdict.level if verdict else "miss",
        "latency_ms": (t_after - t_pre) * 1000,
        "total_latency_ms": (t_after - t0) * 1000,
    }


def run_one_side(*, force_unknown_selector: bool, seed: int = 1337, benign_n: int = 500) -> dict:
    op = make_operator(seed=seed)
    rng = random.Random(seed)

    per_attack = [_drive(op, atk, rng, force_unknown_selector=force_unknown_selector) for atk in HISTORICAL_ATTACKS]
    caught = sum(1 for r in per_attack if r["caught"])
    lat = [r["latency_ms"] for r in per_attack]

    # Benign traffic — `is_known_selector` is already False here, so the
    # ablation doesn't change false-positive counts. Kept for parity.
    fp = 0
    for _ in range(benign_n):
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
            flash_provider="0x000000000000000000000000000000000000dead",
            oracle_addr="0x000000000000000000000000000000000000beef",
            attacker_addr="0x000000000000000000000000000000000000cafe",
            attack_selector="deadbeef",
            price_deviation_getter=lambda _o, _v: 0.0,
            victim_protocol="0x0000000000000000000000000000000000000000",
            observed_at="2026-04-17T00:00:00Z",
        )
        if v is not None and v.level != "noise":
            fp += 1

    return {
        "catches": caught,
        "total_attacks": len(HISTORICAL_ATTACKS),
        "catch_rate": caught / len(HISTORICAL_ATTACKS),
        "p50_ms": round(statistics.median(lat), 3),
        "p95_ms": round(
            statistics.quantiles(lat, n=20)[-1] if len(lat) > 1 else lat[0], 3
        ),
        "false_positives": fp,
        "benign_total": benign_n,
        "per_attack": per_attack,
    }


def main() -> None:
    import sys

    print("running full-feature bench (baseline)...", file=sys.stderr)
    full = run_one_side(force_unknown_selector=False)
    print(
        f"  catches: {full['catches']}/{full['total_attacks']} (p50={full['p50_ms']}ms)",
        file=sys.stderr,
    )

    print(
        "running ablated bench (is_known_selector forced False)...", file=sys.stderr
    )
    ablated = run_one_side(force_unknown_selector=True)
    print(
        f"  catches: {ablated['catches']}/{ablated['total_attacks']} (p50={ablated['p50_ms']}ms)",
        file=sys.stderr,
    )

    summary = {
        "full": {
            "catches": full["catches"],
            "catch_rate": full["catch_rate"],
            "false_positives": full["false_positives"],
            "p50_ms": full["p50_ms"],
        },
        "ablated_known_selector": {
            "catches": ablated["catches"],
            "catch_rate": ablated["catch_rate"],
            "false_positives": ablated["false_positives"],
            "p50_ms": ablated["p50_ms"],
        },
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
