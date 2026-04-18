#!/usr/bin/env bash
# Bring up the full SENTINEL stack with real Groth16 proofs enabled.
#
# Default `docker compose up` runs with RISC0_DEV_MODE=1 (mocked seals
# for fast iteration). This wrapper flips dev mode off and pre-warms
# the three demo-scenario proofs so live requests during the 90-second
# pitch hit the L1/L2 cache instead of burning 15-30s each.
#
# Usage:
#   bash scripts/demo-production-up.sh           # full bring-up + warm
#   bash scripts/demo-production-up.sh --no-warm # skip pre-warm
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export RISC0_DEV_MODE=0
echo "➜ RISC0_DEV_MODE=0 (real Groth16 seals; contracts deploy the real RiscZeroGroth16Verifier)"

echo "➜ docker compose up -d"
docker compose up -d

echo "➜ waiting 30s for services to settle..."
sleep 30

if [[ "${1:-}" != "--no-warm" ]]; then
    echo "➜ pre-warming Groth16 proofs (2-4 min with Bonsai, 15-60 min CPU-only)..."
    bash scripts/pre-warm-proofs.sh || {
        echo "⚠ pre-warm failed. The demo will still run, but first proof"
        echo "  of each circuit will be slow. See scripts/pre-warm-proofs.sh."
        exit 1
    }
fi

echo "✅ demo-production ready — proofs are real Groth16 seals."
echo "   Frontend: http://localhost:3000/#/demo"
echo "   Verify:   bash scripts/e2e-critique-check.sh"
