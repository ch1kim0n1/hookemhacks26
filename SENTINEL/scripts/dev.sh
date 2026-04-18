#!/usr/bin/env bash
# Phase 2 bare-metal orchestration: start redis, anvil, deploy contracts,
# seed state, start every service as a background process, start the
# frontend dev server. PIDs written to /tmp/sentinel-pids for stop.sh.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export PATH="$HOME/.foundry/bin:$HOME/Library/Python/3.11/bin:$PATH"
PIDFILE=/tmp/sentinel-pids
LOGDIR=/tmp/sentinel-logs
mkdir -p "$LOGDIR"
> "$PIDFILE"

record_pid() { echo "$1 $2" >> "$PIDFILE"; }

kill_if_listening() {
    local port=$1
    local pid
    pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo "killing stale process on :$port (pid=$pid)"
        kill "$pid" 2>/dev/null || true
        sleep 0.5
    fi
}

# --- 1. Redis ---
echo "=== [1/6] redis ==="
kill_if_listening 6379
redis-server --daemonize yes --port 6379 --logfile "$LOGDIR/redis.log" >/dev/null
sleep 0.5
redis-cli ping >/dev/null

# --- 2. Anvil ---
echo "=== [2/6] anvil ==="
kill_if_listening 8545
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
    > "$LOGDIR/anvil.log" 2>&1 &
ANVIL_PID=$!
record_pid anvil "$ANVIL_PID"
# Wait for anvil ready.
for i in {1..20}; do
    if cast block-number --rpc-url http://localhost:8545 >/dev/null 2>&1; then break; fi
    sleep 0.3
done
cast block-number --rpc-url http://localhost:8545 >/dev/null

# --- 3. Deploy + seed ---
echo "=== [3/6] deploy + seed ==="
cd "$REPO_ROOT/contracts"
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
    forge script script/DeployLocal.s.sol:DeployLocal \
    --rpc-url http://localhost:8545 --broadcast --skip-simulation \
    > "$LOGDIR/deploy.log" 2>&1
cd "$REPO_ROOT"
bash scripts/seed-demo-state.sh > "$LOGDIR/seed.log" 2>&1

# --- 4. Services ---
echo "=== [4/6] services ==="

start_service() {
    local name=$1 cwd=$2 cmd=$3
    echo "  starting $name"
    ( cd "$cwd" && eval "$cmd" ) > "$LOGDIR/$name.log" 2>&1 &
    record_pid "$name" $!
}

# mempool-monitor (TS) — set WS_URL explicitly (Anvil accepts both HTTP and WS on 8545)
start_service mempool-monitor "$REPO_ROOT/services/mempool-monitor" \
    "RPC_URL=http://127.0.0.1:8545 WS_URL=ws://127.0.0.1:8545 REDIS_URL=redis://127.0.0.1:6379 ADDRESSES_FILE=$REPO_ROOT/config/addresses.local.json pnpm dev"

# counterfactual-sim skeleton
start_service counterfactual-sim "$REPO_ROOT/services/counterfactual-sim" \
    "REDIS_URL=redis://127.0.0.1:6379 pnpm dev"

# api-gateway (REST + WS on same port 8080; WS_PORT override to 8081)
start_service api-gateway "$REPO_ROOT/services/api-gateway" \
    "RPC_URL=http://127.0.0.1:8545 REDIS_URL=redis://127.0.0.1:6379 PORT=8080 WS_PORT=8081 ADDRESSES_FILE=$REPO_ROOT/config/addresses.local.json pnpm dev"

# zk-prover
start_service zk-prover "$REPO_ROOT/services/zk-prover" \
    "PORT=9100 RISC0_DEV_MODE=1 PROVE_POLICY_BIN=$REPO_ROOT/zk/target/release/prove_policy pnpm dev"

# detection-engine (Python)
start_service detection-engine "$REPO_ROOT/services/detection-engine" \
    "REDIS_URL=redis://127.0.0.1:6379 ADDRESSES_FILE=$REPO_ROOT/config/addresses.local.json poetry run python -m detection_engine"

# defense-agent (Python)
start_service defense-agent "$REPO_ROOT/services/defense-agent" \
    "RPC_URL=http://127.0.0.1:8545 REDIS_URL=redis://127.0.0.1:6379 ADDRESSES_FILE=$REPO_ROOT/config/addresses.local.json poetry run python -m defense_agent"

# --- 5. Frontend ---
echo "=== [5/6] frontend ==="
start_service frontend "$REPO_ROOT/frontend" \
    "VITE_WS_URL=ws://127.0.0.1:8081/ws pnpm dev --host"

sleep 2

# --- 6. Status ---
echo "=== [6/6] status ==="
echo ""
echo "✅ sentinel-v2 Phase 2 dev stack up"
echo ""
echo "   Redis:      localhost:6379"
echo "   Anvil:      http://localhost:8545"
echo "   API:        http://localhost:8080"
echo "   WS:         ws://localhost:8081/ws"
echo "   ZK prover:  http://localhost:9100"
echo "   Frontend:   http://localhost:3000"
echo ""
echo "   Logs:       $LOGDIR/"
echo "   PIDs:       $PIDFILE"
echo ""
echo "   Trigger a scenario:"
echo "     curl -X POST http://localhost:8080/api/v1/demo/replay-scenario"
echo ""
echo "   Teardown:   ./scripts/stop.sh"
