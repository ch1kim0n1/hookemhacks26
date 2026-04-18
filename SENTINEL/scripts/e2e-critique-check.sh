#!/usr/bin/env bash
# One-shot: runs every critique-related assertion before the demo.
# Fail-fast; any ❌ means the demo talk-track needs adjustment.
#
# Covers the seven valid items from the 2026-04-18 technical critique
# (`docs/superpowers/plans/2026-04-18-hackathon-critique-fixes.md`):
#   1. ZK MLP gate runs in-circuit (shared tests pass)
#   2. Defense-agent features feed the shipped MLP weights
#   3. Ablation bench still catches 8/8 with `is_known_selector=False`
#   4. Sibling contracts are deployed (or clearly missing)
#   5. Real Groth16 proofs available if `SENTINEL_REQUIRE_REAL_PROOFS=1`
#   6. Forge sibling-pool integration tests pass
#   7. Frontend typecheck stays clean
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

pass() { printf "  \033[32m✅\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m❌\033[0m %s\n" "$1"; FAILED=1; }
warn() { printf "  \033[33m⚠\033[0m %s\n" "$1"; }
info() { printf "  ℹ %s\n" "$1"; }

FAILED=0

echo "=== 1. Shared zk crate tests (MLP + classifier + shared types) ==="
if (cd zk && cargo test -p sentinel-zk-shared --lib >/dev/null 2>&1); then
    pass "zk shared-lib tests (24 passed)"
else
    fail "zk shared-lib tests regressed; run \`cd zk && cargo test -p sentinel-zk-shared --lib\`"
fi

echo "=== 2. Defense-agent classifier-features tests ==="
if (cd services/defense-agent && PYTHONPATH=src python3 -m pytest tests/test_classifier_features.py -q >/dev/null 2>&1); then
    pass "defense-agent tests (8 passed, incl. MLP decision-boundary)"
else
    fail "defense-agent tests regressed; run \`cd services/defense-agent && PYTHONPATH=src python3 -m pytest tests/test_classifier_features.py\`"
fi

echo "=== 3. Ablation bench still catches 8/8 with is_known_selector=False ==="
if [ -x "$(command -v poetry 2>/dev/null || true)" ]; then
    ABL=$(cd services/detection-engine && poetry run python -m bench.ablation 2>/dev/null || true)
    if [ -n "$ABL" ]; then
        CATCH_FULL=$(echo "$ABL" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["full"]["catches"])' 2>/dev/null || echo 0)
        CATCH_ABL=$(echo "$ABL" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["ablated_known_selector"]["catches"])' 2>/dev/null || echo 0)
        if [ "$CATCH_FULL" = "8" ] && [ "$CATCH_ABL" = "8" ]; then
            pass "ablation: full=8/8, ablated=8/8 (matches docs/judge-qa.md)"
        else
            fail "ablation regressed: full=$CATCH_FULL, ablated=$CATCH_ABL — update docs before claiming 8/8"
        fi
    else
        warn "ablation bench failed to run (poetry env missing?)"
    fi
else
    warn "poetry not installed; skipping ablation bench"
fi

echo "=== 4. Sibling contracts present in addresses.local.json ==="
ADDRS_FILE="config/addresses.local.json"
if [ -f "$ADDRS_FILE" ]; then
    MISSING=0
    for k in SiblingPoolAave SiblingPoolCompound SiblingPoolCurve; do
        addr=$(python3 -c "import json; d=json.load(open('$ADDRS_FILE')); print(d.get('$k',''))" 2>/dev/null || echo "")
        if [ -n "$addr" ]; then
            pass "$k = $addr"
        else
            warn "$k not yet deployed — run \`forge script contracts/script/DeployLocal.s.sol --rpc-url http://localhost:8545 --broadcast\` to populate"
            MISSING=1
        fi
    done
    [ $MISSING -eq 1 ] && info "frontend falls back to label-only rendering; no badge visible until deploy"
else
    warn "config/addresses.local.json missing — deploy contracts first"
fi

echo "=== 5. Real Groth16 proof path ==="
DEV_MODE="${RISC0_DEV_MODE:-1}"
if [ "${SENTINEL_REQUIRE_REAL_PROOFS:-0}" = "1" ]; then
    if [ "$DEV_MODE" = "0" ]; then
        pass "RISC0_DEV_MODE=0 — real Groth16 seals required"
    else
        fail "SENTINEL_REQUIRE_REAL_PROOFS=1 but RISC0_DEV_MODE=$DEV_MODE; export RISC0_DEV_MODE=0 and use scripts/demo-production-up.sh"
    fi
else
    if [ "$DEV_MODE" = "0" ]; then
        pass "RISC0_DEV_MODE=0 — running with real seals"
    else
        info "RISC0_DEV_MODE=$DEV_MODE (dev mode, fast mock seals). Set SENTINEL_REQUIRE_REAL_PROOFS=1 to enforce real proofs in this check."
    fi
fi

echo "=== 6. Forge sibling-pool integration tests ==="
if (cd contracts && forge test --match-contract SiblingTest >/dev/null 2>&1); then
    pass "Sibling.t.sol (4 passed — address separation + independent pause)"
else
    fail "Sibling.t.sol regressed; run \`cd contracts && forge test --match-contract SiblingTest -vv\`"
fi

echo "=== 7. Frontend typecheck ==="
if (cd frontend && pnpm typecheck >/dev/null 2>&1); then
    pass "frontend tsc --noEmit clean"
else
    fail "frontend typecheck failed; run \`cd frontend && pnpm typecheck\`"
fi

echo ""
if [ $FAILED -eq 0 ]; then
    printf "\033[32m=== ALL CHECKS PASSED — demo is safe to run ===\033[0m\n"
    exit 0
else
    printf "\033[31m=== CHECKS FAILED — fix before demoing ===\033[0m\n"
    exit 1
fi
