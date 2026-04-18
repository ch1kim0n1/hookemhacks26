#!/usr/bin/env bash
# Kill anvil, restart, redeploy contracts with the canonical policy
# hash, and seed demo state. Idempotent — safe to re-run between demo
# runs.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAPSHOT_FILE="$REPO_ROOT/config/anvil-snapshot.json"

# Fast path: revert to snapshot if available
if [ -f "$SNAPSHOT_FILE" ]; then
    SNAPSHOT_ID=$(jq -r .snapshotId "$SNAPSHOT_FILE" 2>/dev/null)
    if [ -n "$SNAPSHOT_ID" ] && [ "$SNAPSHOT_ID" != "null" ]; then
        if cast rpc evm_revert --rpc-url http://127.0.0.1:8545 "$SNAPSHOT_ID" >/dev/null 2>&1; then
            echo "Reverted to snapshot $SNAPSHOT_ID"
            # Re-snapshot (evm_revert consumes the snapshot)
            NEW_ID=$(cast rpc evm_snapshot --rpc-url http://127.0.0.1:8545 | tr -d '"')
            echo "{\"snapshotId\": \"$NEW_ID\", \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
                > "$SNAPSHOT_FILE"
            redis-cli -p 6379 FLUSHALL >/dev/null 2>&1 || true
            echo "Fast reset complete"
            exit 0
        fi
    fi
fi
echo "Snapshot revert failed or unavailable, falling back to full reset..."

cd "$REPO_ROOT"
export PATH="$HOME/.foundry/bin:$PATH"

echo "=== [1/4] kill existing anvil ==="
pkill -f "^anvil " 2>/dev/null || true
sleep 0.5

echo "=== [2/4] boot fresh anvil ==="
anvil \
    --host 127.0.0.1 \
    --port 8545 \
    --block-time 2 \
    --chain-id 31337 \
    --gas-limit 30000000 \
    --accounts 10 \
    --mnemonic "test test test test test test test test test test test junk" \
    > /tmp/sentinel-anvil.log 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 30); do
    if cast block-number --rpc-url http://localhost:8545 >/dev/null 2>&1; then
        break
    fi
    sleep 0.3
done
if ! cast block-number --rpc-url http://localhost:8545 >/dev/null 2>&1; then
    echo "ERROR: Anvil did not come up (log: /tmp/sentinel-anvil.log)"
    exit 1
fi
echo "Anvil ready on :8545 (pid=$ANVIL_PID)"

echo "=== [3/4] redeploy contracts with canonical policy hash ==="
POLICY_HASH="$("$REPO_ROOT/scripts/compute-policy-hash.sh")"
echo "   policy hash: $POLICY_HASH"
cd contracts
DEPLOYER_KEY="${DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}" \
POLICY_HASH="$POLICY_HASH" \
    forge script script/DeployLocal.s.sol:DeployLocal \
    --rpc-url http://localhost:8545 \
    --broadcast \
    --skip-simulation
cd "$REPO_ROOT"

echo "=== [4/4] seed demo state ==="
./scripts/seed-demo-state.sh

echo ""
echo "✅ reset complete (anvil pid=$ANVIL_PID)"
