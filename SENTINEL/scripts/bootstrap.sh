#!/usr/bin/env bash
# SENTINEL v2 — Phase 1 bootstrap
#
# Idempotent. Safe to re-run. Phase 1 scope:
#   1. Install Foundry libraries (forge install)
#   2. Build contracts
#   3. Install pnpm workspace deps
#   4. Boot local Anvil
#   5. Deploy stub contracts via forge script
#   6. Write /config/addresses.local.json
#
# Deferred to Phase 2 (needs real toolchain):
#   - Python poetry installs
#   - RISC Zero guest builds (cargo risczero build)
#   - docker compose up

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Ensure foundry binaries are on PATH (installed via foundryup to ~/.foundry/bin).
export PATH="$HOME/.foundry/bin:$PATH"

if [ "${SENTINEL_COMPOSE:-0}" = "1" ]; then
    echo "Compose mode: starting infra services..."
    docker compose up -d anvil redis postgres
    echo "Waiting for Anvil + Redis..."
    for i in $(seq 1 15); do
        if cast rpc eth_blockNumber --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1 && \
           redis-cli -p 6379 ping >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
fi

# Run Postgres migrations
echo "Running Postgres migrations..."
./scripts/migrate.sh

echo "=== [1/5] forge install ==="
cd contracts
if [ ! -d "lib/forge-std" ]; then
    forge install --no-git foundry-rs/forge-std@v1.7.6
fi
if [ ! -d "lib/openzeppelin-contracts" ]; then
    forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.0.2
fi
# risc0-ethereum is vendored at contracts/lib/risc0-ethereum@v3.0.1.

cd "$REPO_ROOT"

echo "=== [2/6] build zk guests + emit image IDs ==="
if command -v cargo >/dev/null 2>&1; then
    # Build release bins: prove_{policy,counterfactual,learning} + dump_image_ids.
    # RISC0_DEV_MODE defaults to 1 for local dev; set to 0 for real proofs.
    export RISC0_DEV_MODE="${RISC0_DEV_MODE:-1}"
    (cd zk && cargo build --release --bins)
    # Write config/zk-image-ids.json — DeployLocal.s.sol reads this to
    # pin each verifier wrapper to its specific guest ELF.
    ./zk/target/release/dump_image_ids > /dev/null
    echo "   zk-image-ids.json written"
else
    echo "cargo not found — cannot build zk guests. Install via rustup."
    exit 1
fi

cd "$REPO_ROOT/contracts"
echo "=== [3/6] forge build ==="
forge build

cd "$REPO_ROOT"

echo "=== [4/6] pnpm install ==="
if command -v pnpm >/dev/null 2>&1; then
    pnpm install --no-frozen-lockfile
else
    echo "pnpm not installed — skipping. Install via 'npm i -g pnpm@8.15.4'"
fi

echo "=== [5/6] boot Anvil (background) ==="
# Kill any prior anvil from a previous run of this script.
pkill -f "^anvil " 2>/dev/null || true
sleep 0.5

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
trap "kill $ANVIL_PID 2>/dev/null || true" EXIT

# Wait for anvil to be responsive.
for i in {1..20}; do
    if cast block-number --rpc-url http://localhost:8545 >/dev/null 2>&1; then
        break
    fi
    sleep 0.3
done
if ! cast block-number --rpc-url http://localhost:8545 >/dev/null 2>&1; then
    echo "ERROR: Anvil did not come up. Check /tmp/sentinel-anvil.log"
    exit 1
fi
echo "Anvil ready on :8545 (pid=$ANVIL_PID)"

echo "=== [6/6] deploy contracts with canonical policy hash ==="
POLICY_HASH="$("$REPO_ROOT/scripts/compute-policy-hash.sh")"
echo "   policy hash: $POLICY_HASH"
cd contracts
DEPLOYER_KEY=${DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80} \
POLICY_HASH="$POLICY_HASH" \
RISC0_DEV_MODE="${RISC0_DEV_MODE:-1}" \
    forge script script/DeployLocal.s.sol:DeployLocal \
    --rpc-url http://localhost:8545 \
    --broadcast \
    --skip-simulation

cd "$REPO_ROOT"

# Snapshot Anvil state post-deployment
echo "Taking Anvil snapshot..."
SNAPSHOT_ID=$(cast rpc evm_snapshot --rpc-url http://127.0.0.1:8545 | tr -d '"')
echo "{\"snapshotId\": \"$SNAPSHOT_ID\", \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    > "$REPO_ROOT/config/anvil-snapshot.json"
echo "Snapshot saved: $SNAPSHOT_ID"

if [ "${SENTINEL_COMPOSE:-0}" = "1" ]; then
    echo "Starting remaining services..."
    docker compose up -d
fi

echo ""
echo "✅ Phase 1 bootstrap complete."
echo "   Anvil running on :8545 (log: /tmp/sentinel-anvil.log)"
echo "   Addresses: $REPO_ROOT/config/addresses.local.json"
echo ""
echo "   To tear down: kill $ANVIL_PID"
echo ""

# Leave Anvil running — the trap only fires if the script exits
# unexpectedly. For a graceful exit we clear the trap so the caller
# can interact with the live chain.
trap - EXIT
