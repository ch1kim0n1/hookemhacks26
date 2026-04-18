#!/usr/bin/env python3
"""Lightweight load probe for the scan API (Phase 9 benchmarking)."""

from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.request


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://127.0.0.1:8000/api/scan")
    p.add_argument("--requests", type=int, default=50)
    p.add_argument("--payload", default="Benign quarterly earnings summary.")
    args = p.parse_args()

    data = json.dumps({"content": args.payload, "tool_name": "bench"}).encode()

    latencies: list[float] = []
    for _ in range(args.requests):
        t0 = time.perf_counter()
        req = urllib.request.Request(
            args.url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=30).read()
        latencies.append((time.perf_counter() - t0) * 1000)

    latencies.sort()
    p95 = latencies[int(0.95 * (len(latencies) - 1))]
    print(
        f"n={args.requests} p50={statistics.median(latencies):.1f}ms "
        f"p95={p95:.1f}ms max={max(latencies):.1f}ms"
    )


if __name__ == "__main__":
    main()
