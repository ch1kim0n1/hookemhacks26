#!/usr/bin/env bash
# Pre-pitch validation: 10 consecutive clean runs of the full demo.
# Wraps demo-smoke-test.sh with RUNS=10 and an explicit pass/fail banner.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RUNS="${RUNS:-10}"
MODE="${1:-}"

echo "========================================"
echo "  SENTINEL soak test — ${RUNS} runs"
echo "========================================"

if RUNS="$RUNS" ./scripts/demo-smoke-test.sh $MODE; then
    echo ""
    echo "✅ PASS — ${RUNS} consecutive clean runs. Ready to pitch."
    exit 0
else
    echo ""
    echo "❌ FAIL — demo is not stable. Fix failures before pitching."
    exit 1
fi
