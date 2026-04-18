"""Historical-attack replay benchmark entrypoint.

Usage (from services/detection-engine):
    poetry run python -m bench.run

Outputs
    bench/results/historical_attacks.json   machine-readable
    bench/results/historical_attacks.md     judge-ready table
    bench/results/latency_chart.txt         ASCII bar chart
    bench/results/latency_chart.png         matplotlib chart (if available)
"""
from __future__ import annotations

import json
import random
import statistics
import time
from pathlib import Path

from .attack_corpus import HISTORICAL_ATTACKS, total_losses_usd_millions
from .replay import ReplayResult, make_operator, replay_attack, replay_benign

RESULTS_DIR = Path(__file__).parent / "results"
N_BENIGN = 500


def _aggregate(results: list[ReplayResult]) -> dict:
    latencies = [r.latency_ms_exploit_tx for r in results]
    e2e = [r.latency_ms_flash_to_verdict for r in results]
    caught = [r for r in results if r.caught]
    loss_saved = sum(r.loss_usd_millions for r in caught)
    loss_total = sum(r.loss_usd_millions for r in results)
    return {
        "total_attacks": len(results),
        "caught": len(caught),
        "catch_rate": len(caught) / len(results) if results else 0.0,
        "loss_total_usd_m": loss_total,
        "loss_would_have_blocked_usd_m": loss_saved,
        "loss_blocked_pct": (loss_saved / loss_total) if loss_total else 0.0,
        "exploit_tx_latency_ms": {
            "min": min(latencies),
            "p50": statistics.median(latencies),
            "p95": _percentile(latencies, 95),
            "max": max(latencies),
            "mean": statistics.mean(latencies),
        },
        "end_to_end_latency_ms": {
            "min": min(e2e),
            "p50": statistics.median(e2e),
            "p95": _percentile(e2e, 95),
            "max": max(e2e),
            "mean": statistics.mean(e2e),
        },
    }


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    sorted_ = sorted(values)
    idx = min(len(sorted_) - 1, int(round((p / 100) * (len(sorted_) - 1))))
    return sorted_[idx]


def _ascii_bar(value: float, max_value: float, width: int = 30) -> str:
    if max_value <= 0:
        return ""
    n = int(round((value / max_value) * width))
    return "█" * n + "·" * (width - n)


def _write_markdown(
    path: Path,
    results: list[ReplayResult],
    agg: dict,
    benign: dict,
    elapsed_s: float,
) -> None:
    lines: list[str] = []
    w = lines.append
    w("# SENTINEL Historical-Attack Replay Benchmark")
    w("")
    w(
        "Each row replays the kill-chain of a real DeFi exploit through the "
        "SENTINEL detection engine and measures whether the attacker would "
        "have been stopped."
    )
    w("")
    w("## Headline")
    w("")
    w(
        f"- **{agg['caught']} / {agg['total_attacks']}** historical attacks "
        f"caught (**{agg['catch_rate']*100:.1f}%** catch rate)"
    )
    w(
        f"- **${agg['loss_would_have_blocked_usd_m']:.1f}M** of "
        f"**${agg['loss_total_usd_m']:.1f}M** losses would have been blocked "
        f"({agg['loss_blocked_pct']*100:.1f}%)"
    )
    w(
        f"- Exploit-tx detection latency: "
        f"**p50 {agg['exploit_tx_latency_ms']['p50']:.2f} ms**, "
        f"p95 {agg['exploit_tx_latency_ms']['p95']:.2f} ms, "
        f"max {agg['exploit_tx_latency_ms']['max']:.2f} ms"
    )
    w(
        f"- False-positive rate on {benign['n']} benign txs: "
        f"**{benign['fp_rate']*100:.3f}%** "
        f"({benign['false_positives']} false fires); "
        f"{benign['ms_per_tx']:.3f} ms/tx throughput"
    )
    w(f"- Total wall-clock benchmark time: {elapsed_s:.2f} s")
    w("")
    w("## Per-attack detail")
    w("")
    w("| # | Attack | Year | Loss ($M) | Caught | Confidence | Level | Exploit-tx latency | Latency bar |")
    w("|---|---|---|---:|:-:|---:|:-:|---:|:---|")
    max_lat = max(r.latency_ms_exploit_tx for r in results)
    for i, r in enumerate(results, 1):
        bar = _ascii_bar(r.latency_ms_exploit_tx, max_lat, width=24)
        caught = "✅" if r.caught else "❌"
        w(
            f"| {i} | {r.attack_name} | "
            f"{HISTORICAL_ATTACKS[i-1].year} | "
            f"{r.loss_usd_millions:.2f} | {caught} | "
            f"{r.confidence_bp/100:.1f}% | {r.level} | "
            f"{r.latency_ms_exploit_tx:.2f} ms | `{bar}` |"
        )
    w("")
    w("## Latency distribution")
    w("")
    w("```")
    w(f"exploit-tx latency (ms)  n={len(results)}")
    for r in results:
        bar = _ascii_bar(r.latency_ms_exploit_tx, max_lat, width=40)
        w(f"  {r.attack_name:<28} {r.latency_ms_exploit_tx:>7.2f}  {bar}")
    w("```")
    w("")
    w("## Methodology")
    w("")
    w(
        "- Each attack is encoded as a 3-step kill-chain "
        "(`flash-loan → oracle-impact → exploit-call`) reconstructed from "
        "the exploit's public post-mortem. Flash-loan size, oracle "
        "deviation %, and attack selector are pattern-faithful; "
        "counterparty addresses are stable synthetic values."
    )
    w(
        "- A single `Operator` (seed=1337) is warmed up once on a 300-normal "
        "/ 200-attack synthetic corpus, then every attack + benign tx runs "
        "through the same detector."
    )
    w(
        "- Latency is wall-clock from `Operator.evaluate(exploit_tx)` entry "
        "to return (`p50 / p95 / max` reported). The end-to-end number in "
        "the headline covers all three kill-chain steps."
    )
    w(
        "- Benchmark is fully deterministic given the seed; re-run with "
        "`poetry run python -m bench.run` to reproduce."
    )
    path.write_text("\n".join(lines) + "\n")


def _write_ascii_chart(path: Path, results: list[ReplayResult]) -> None:
    max_lat = max(r.latency_ms_exploit_tx for r in results)
    lines = [f"SENTINEL detection latency per historical attack (ms, n={len(results)})", ""]
    for r in results:
        bar = _ascii_bar(r.latency_ms_exploit_tx, max_lat, width=50)
        caught = "✓" if r.caught else "✗"
        lines.append(
            f"{caught} {r.attack_name:<28} {r.latency_ms_exploit_tx:>7.2f} {bar}"
        )
    path.write_text("\n".join(lines) + "\n")


def _try_write_png(
    path: Path, results: list[ReplayResult], agg: dict
) -> bool:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return False

    names = [r.attack_name for r in results]
    lats = [r.latency_ms_exploit_tx for r in results]
    colors = ["#2ea043" if r.caught else "#cf222e" for r in results]

    fig, ax = plt.subplots(figsize=(10, 5.5))
    bars = ax.barh(names, lats, color=colors)
    ax.invert_yaxis()
    ax.set_xlabel("Exploit-tx detection latency (ms)")
    ax.set_title(
        f"SENTINEL historical-attack replay — "
        f"{agg['caught']}/{agg['total_attacks']} caught, "
        f"p50 {agg['exploit_tx_latency_ms']['p50']:.2f} ms"
    )
    ax.grid(axis="x", linestyle="--", alpha=0.4)
    for bar, r in zip(bars, results):
        ax.text(
            bar.get_width() + max(lats) * 0.01,
            bar.get_y() + bar.get_height() / 2,
            f"{r.confidence_bp/100:.0f}%",
            va="center",
            fontsize=8,
        )
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)
    return True


def main() -> int:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[bench] replaying {len(HISTORICAL_ATTACKS)} historical attacks "
          f"(${total_losses_usd_millions():.1f}M combined losses)...")

    t0 = time.perf_counter()
    rng = random.Random(0xBE7CF00D)
    op = make_operator(seed=1337)
    print(f"[bench] operator warmed up: model_hash={op.model_hash[:14]}...")

    results: list[ReplayResult] = []
    for atk in HISTORICAL_ATTACKS:
        r = replay_attack(op, atk, rng=rng)
        status = "CAUGHT" if r.caught else "MISS"
        print(
            f"  {status:<6} {r.attack_name:<28} "
            f"conf={r.confidence_bp/100:5.1f}%  "
            f"t={r.latency_ms_exploit_tx:6.2f}ms  level={r.level}"
        )
        results.append(r)

    print(f"[bench] streaming {N_BENIGN} benign txs for FP measurement...")
    benign = replay_benign(op, N_BENIGN, rng=rng)
    print(
        f"[bench] FP rate: {benign['fp_rate']*100:.3f}% "
        f"({benign['false_positives']}/{benign['n']})"
    )

    elapsed = time.perf_counter() - t0
    agg = _aggregate(results)

    # Write outputs.
    json_path = RESULTS_DIR / "historical_attacks.json"
    json_path.write_text(
        json.dumps(
            {
                "aggregate": agg,
                "benign": benign,
                "per_attack": [r.__dict__ for r in results],
                "elapsed_seconds": elapsed,
            },
            indent=2,
        )
        + "\n"
    )
    _write_markdown(
        RESULTS_DIR / "historical_attacks.md", results, agg, benign, elapsed
    )
    _write_ascii_chart(RESULTS_DIR / "latency_chart.txt", results)
    png_written = _try_write_png(
        RESULTS_DIR / "latency_chart.png", results, agg
    )

    print("\n" + "=" * 70)
    print(
        f"HEADLINE: {agg['caught']}/{agg['total_attacks']} caught, "
        f"${agg['loss_would_have_blocked_usd_m']:.1f}M of "
        f"${agg['loss_total_usd_m']:.1f}M blocked "
        f"({agg['loss_blocked_pct']*100:.1f}%); "
        f"p50 {agg['exploit_tx_latency_ms']['p50']:.2f} ms, "
        f"FP {benign['fp_rate']*100:.3f}%"
    )
    print(f"wrote: {json_path}")
    print(f"wrote: {RESULTS_DIR / 'historical_attacks.md'}")
    print(f"wrote: {RESULTS_DIR / 'latency_chart.txt'}")
    if png_written:
        print(f"wrote: {RESULTS_DIR / 'latency_chart.png'}")
    else:
        print("skipped PNG (matplotlib not installed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
