#!/usr/bin/env bash
# E2E test: run the learning-loop training cycle and verify it produces telemetry.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$HOME/.foundry/bin:$PATH"

echo "=== Learning Loop E2E Test ==="

# 1. Check prerequisites
cast rpc eth_blockNumber --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1 || { echo "ERROR: Anvil not running"; exit 1; }
redis-cli -p 6379 ping >/dev/null 2>&1 || { echo "ERROR: Redis not running"; exit 1; }
ADDRESSES_FILE="$REPO_ROOT/config/addresses.local.json"
[ -f "$ADDRESSES_FILE" ] || { echo "ERROR: Run bootstrap.sh first"; exit 1; }

POLICY_REGISTRY=$(jq -r .PolicyRegistry "$ADDRESSES_FILE")
echo "PolicyRegistry: $POLICY_REGISTRY"

# 2. Get current policy hash
OLD_HASH=$(cast call "$POLICY_REGISTRY" "currentPolicyHash()(bytes32)" --rpc-url http://127.0.0.1:8545)
echo "Current policy hash: $OLD_HASH"

# 3. Clear previous training telemetry
redis-cli DEL sentinel.training.telemetry >/dev/null 2>&1 || true

# 4. Run learning-loop with fast settings
echo "Starting learning-loop (5 variants, 3 gens, 0.6 threshold)..."
POLICY_REGISTRY_ADDRESS="$POLICY_REGISTRY" \
LEARNING_LOOP_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" \
POPULATION_SIZE=5 \
WIN_RATE_THRESHOLD=0.6 \
MAX_GENERATIONS=3 \
GENERATION_DELAY_MS=500 \
RPC_URL=http://127.0.0.1:8545 \
REDIS_URL=redis://127.0.0.1:6379 \
POLICY_PATH="$REPO_ROOT/config/policy.json" \
ADDRESSES_FILE="$ADDRESSES_FILE" \
HEALTH_PORT=9005 \
    timeout 30 pnpm --filter @sentinel/learning-loop exec tsx src/index.ts &
LOOP_PID=$!

# 5. Wait for training
sleep 15

# 6. Check telemetry
TELEMETRY_COUNT=$(redis-cli XLEN sentinel.training.telemetry 2>/dev/null || echo "0")
echo "Telemetry events: $TELEMETRY_COUNT"

kill $LOOP_PID 2>/dev/null || true
wait $LOOP_PID 2>/dev/null || true

if [ "$TELEMETRY_COUNT" -gt 0 ]; then
    echo "✅ Training telemetry published ($TELEMETRY_COUNT events)"
else
    echo "❌ No training telemetry found"
    exit 1
fi

# 7. Check policy hash
NEW_HASH=$(cast call "$POLICY_REGISTRY" "currentPolicyHash()(bytes32)" --rpc-url http://127.0.0.1:8545)
if [ "$NEW_HASH" != "$OLD_HASH" ]; then
    echo "✅ Policy hash updated on-chain"
else
    echo "⚠️  Policy hash unchanged (acceptable — convergence not guaranteed in 3 gens)"
fi

# 8. Regression: Phase 3 demo still works
echo ""
echo "Running Phase 3 regression..."
RUNS=1 ./scripts/demo-smoke-test.sh
echo ""
echo "✅ Learning Loop E2E PASSED"
