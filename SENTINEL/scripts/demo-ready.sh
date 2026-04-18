#!/usr/bin/env bash
# One-shot: pre-flight + proof pre-warm. Exit 0 only when the demo stack is ready.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "═══ SENTINEL demo-ready ═══"
echo ""

if bash ./scripts/demo-preflight.sh; then
  echo ""
else
  echo ""
  echo "❌ pre-flight failed — fix issues above before pre-warming proofs."
  exit 1
fi

echo ""
echo "── Pre-warming zk-prover cache (may take 1–3 min on first run) ──"
if bash ./scripts/pre-warm-proofs.sh; then
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "✅ READY — open http://localhost:3000/#/demo"
  echo "══════════════════════════════════════════════════════════════"
  exit 0
else
  echo ""
  echo "❌ pre-warm failed — check zk-prover logs on port 9100"
  exit 1
fi
