#!/usr/bin/env bash
# Run both scenarios back-to-back N times (default 3).
# Between iterations: reset anvil + restart every service.
# Fails on any single iteration failure.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$HOME/.foundry/bin:$PATH"

COMPOSE_MODE=0
if [[ "${1:-}" == "--compose" ]]; then
    COMPOSE_MODE=1
    shift
fi

RUNS="${RUNS:-3}"
FAILURES=0

VENV_DET=~/Library/Caches/pypoetry/virtualenvs/sentinel-detection-engine-jC4VcgnV-py3.11/bin/python
VENV_DA=~/Library/Caches/pypoetry/virtualenvs/sentinel-defense-agent-wxjoK8gk-py3.11/bin/python
LOGDIR=/tmp/sentinel-logs
mkdir -p "$LOGDIR"

boot_services() {
    PROVE_POLICY_BIN="$REPO_ROOT/zk/target/release/prove_policy" \
    RISC0_DEV_MODE=1 REDIS_URL=redis://127.0.0.1:6379 RPC_URL=http://127.0.0.1:8545 \
    ADDRESSES_FILE="$REPO_ROOT/config/addresses.local.json" \
        nohup pnpm --filter @sentinel/zk-prover exec tsx src/index.ts \
        > "$LOGDIR/zk-prover.log" 2>&1 &
    REDIS_URL=redis://127.0.0.1:6379 RPC_URL=http://127.0.0.1:8545 \
    ADDRESSES_FILE="$REPO_ROOT/config/addresses.local.json" \
    POLICY_PATH="$REPO_ROOT/config/policy.json" \
        nohup pnpm --filter @sentinel/api-gateway exec tsx src/index.ts \
        > "$LOGDIR/api-gateway.log" 2>&1 &
    REDIS_URL=redis://127.0.0.1:6379 RPC_URL=http://127.0.0.1:8545 WS_URL=ws://127.0.0.1:8545 \
    ADDRESSES_FILE="$REPO_ROOT/config/addresses.local.json" \
        nohup pnpm --filter @sentinel/mempool-monitor exec tsx src/index.ts \
        > "$LOGDIR/mempool-monitor.log" 2>&1 &
    ANVIL_BIN="$HOME/.foundry/bin/anvil" \
    REDIS_URL=redis://127.0.0.1:6379 RPC_URL=http://127.0.0.1:8545 \
    ADDRESSES_FILE="$REPO_ROOT/config/addresses.local.json" \
    PROFILE_FILE="$REPO_ROOT/config/protocol-profiles/victim-lending-pool.json" \
    PATH="$HOME/.foundry/bin:$PATH" \
        nohup pnpm --filter @sentinel/counterfactual-sim exec tsx src/index.ts \
        > "$LOGDIR/counterfactual-sim.log" 2>&1 &
    ( cd services/detection-engine
      REDIS_URL=redis://127.0.0.1:6379 \
      ADDRESSES_FILE="$REPO_ROOT/config/addresses.local.json" \
        nohup $VENV_DET -m detection_engine > "$LOGDIR/detection-engine.log" 2>&1 & )
    ( cd services/defense-agent
      REDIS_URL=redis://127.0.0.1:6379 RPC_URL=http://127.0.0.1:8545 \
      ZK_PROVER_URL=http://127.0.0.1:9100 POLICY_PATH="$REPO_ROOT/config/policy.json" \
      ADDRESSES_FILE="$REPO_ROOT/config/addresses.local.json" \
        nohup $VENV_DA -m defense_agent > "$LOGDIR/defense-agent.log" 2>&1 & )
    sleep 5
}

kill_services() {
    pkill -f "@sentinel/" 2>/dev/null || true
    pkill -f "defense_agent" 2>/dev/null || true
    pkill -f "detection_engine" 2>/dev/null || true
    sleep 2
}

boot_services_compose() {
    docker compose up -d --build
    echo "Waiting for healthy services..."
    # Poll health endpoints instead of sleeping
    for port in 8080 9001 9002 9003 9004 9100; do
        for i in $(seq 1 30); do
            if curl -sf "http://127.0.0.1:$port/health" >/dev/null 2>&1 || \
               curl -sf "http://127.0.0.1:$port/api/v1/health" >/dev/null 2>&1; then
                break
            fi
            sleep 1
        done
    done
    echo "Services ready"
}

kill_services_compose() {
    docker compose down --remove-orphans 2>/dev/null || true
}

for i in $(seq 1 "$RUNS"); do
    echo "=================="
    echo "iteration $i / $RUNS"
    echo "=================="
    if [ "$COMPOSE_MODE" -eq 1 ]; then
        kill_services_compose
        ./scripts/reset.sh >/dev/null 2>&1 || true
        boot_services_compose
    else
        kill_services
        ./scripts/reset.sh >/dev/null 2>&1
        redis-cli -p 6379 FLUSHALL >/dev/null
        boot_services
    fi
    if ! ./scripts/test-scenario-a.sh; then
        FAILURES=$((FAILURES+1))
        echo "iteration $i: Scenario A failed"
        continue
    fi
    if ! ./scripts/test-scenario-b.sh; then
        FAILURES=$((FAILURES+1))
        echo "iteration $i: Scenario B failed"
        continue
    fi
done

echo ""
echo "===================="
echo "failures: $FAILURES / $RUNS"
if [ "$FAILURES" -gt 0 ]; then
    exit 1
fi
echo "✅ ${RUNS} consecutive clean runs"
