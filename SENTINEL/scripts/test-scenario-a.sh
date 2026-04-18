#!/usr/bin/env bash
# E2E test: Scenario A completes within the SLA.
# Assumes the full stack is already running (anvil, redis, all services).
# Use ./scripts/dev.sh to bring up the stack first.
#
# This test is idempotent but NOT resetting — after the first run, the
# victim is paused on-chain and subsequent runs would fail the
# "attacker reverts" assertion. Run ./scripts/reset.sh + restart
# services between runs if you need a clean state.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$HOME/.foundry/bin:$PATH"

API="${API_BASE:-http://localhost:8080}"
DEMO_TOKEN="${SENTINEL_DEMO_TOKEN:-sentinel-demo}"
ADDR_FILE=config/addresses.local.json
PAUSE_CONTROLLER=$(jq -r .PauseController "$ADDR_FILE")
VICTIM=$(jq -r .VictimLendingPool "$ADDR_FILE")
LEDGER=$(jq -r .CounterfactualLedger "$ADDR_FILE")
RPC=${RPC_URL:-http://localhost:8545}

start=$(python3 -c "import time; print(int(time.time()*1000))")
INITIAL_LEDGER=$(cast call "$LEDGER" "getEntryCount()(uint256)" --rpc-url "$RPC" | awk '{print $1}')

curl -sSf -X POST "$API/api/v1/demo/replay-scenario" -H "x-demo-token: $DEMO_TOKEN" >/dev/null

paused="false"
ledger_count="$INITIAL_LEDGER"
for _ in $(seq 1 80); do
    paused=$(cast call "$PAUSE_CONTROLLER" "isPaused(address)(bool)" "$VICTIM" --rpc-url "$RPC" 2>/dev/null)
    ledger_count=$(cast call "$LEDGER" "getEntryCount()(uint256)" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')
    if [ "$paused" = "true" ] && [ "$ledger_count" -gt "$INITIAL_LEDGER" ]; then
        break
    fi
    sleep 0.25
done

end=$(python3 -c "import time; print(int(time.time()*1000))")
elapsed=$((end - start))

if [ "$paused" != "true" ]; then
    echo "❌ pause did not activate within 20s"
    exit 1
fi
if [ "$ledger_count" -le "$INITIAL_LEDGER" ]; then
    echo "❌ counterfactual ledger did not grow (was $INITIAL_LEDGER, now $ledger_count)"
    exit 1
fi

echo "✅ Scenario A: pause + ledger entry in ~${elapsed}ms (ledger ${INITIAL_LEDGER}→${ledger_count})"
if [ "$elapsed" -gt 10000 ]; then
    echo "⚠️  exceeded 10s SLA from doc 09"
    exit 1
fi
