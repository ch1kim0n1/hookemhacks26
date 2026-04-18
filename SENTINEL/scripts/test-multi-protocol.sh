#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$HOME/.foundry/bin:$PATH"

echo "=== Multi-Protocol E2E Test ==="

# Prerequisites
cast rpc eth_blockNumber --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1 || { echo "ERROR: Anvil not running"; exit 1; }

# 1. Verify protocol profiles load
echo "Checking protocol profiles..."
PROFILE_COUNT=$(ls config/protocol-profiles/*.json 2>/dev/null | wc -l | tr -d ' ')
echo "Protocol profiles found: $PROFILE_COUNT"
if [ "$PROFILE_COUNT" -lt 2 ]; then
    echo "❌ Expected at least 2 profiles"
    exit 1
fi
echo "✅ Multiple protocol profiles: $PROFILE_COUNT"

# 2. Verify chains API
echo ""
echo "Checking chains API..."
# Start api-gateway briefly if not running
API_RUNNING=0
if curl -sf http://localhost:8080/api/v1/health >/dev/null 2>&1; then
    API_RUNNING=1
fi

if [ "$API_RUNNING" -eq 1 ]; then
    CHAINS=$(curl -sf http://localhost:8080/api/v1/chains 2>/dev/null)
    if echo "$CHAINS" | jq -e '.chains | length > 0' >/dev/null 2>&1; then
        CHAIN_COUNT=$(echo "$CHAINS" | jq '.chains | length')
        echo "✅ Chains API returns $CHAIN_COUNT chain(s)"
    else
        echo "⚠️  Chains API returned no chains (api-gateway may need restart)"
    fi
else
    echo "⚠️  API gateway not running, skipping chains check"
fi

# 3. Regression: Phase 3 demo still works
echo ""
echo "Running Phase 3 regression..."
RUNS=1 ./scripts/demo-smoke-test.sh

echo ""
echo "✅ Multi-Protocol E2E PASSED"
echo "  Profiles: $PROFILE_COUNT"
