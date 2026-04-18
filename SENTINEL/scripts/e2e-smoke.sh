#!/usr/bin/env bash
# Phase 2 E2E smoke: trigger the demo scenario via api-gateway, then
# assert that the full pipeline fired (detection → defense → on-chain pause).
#
# Requires: scripts/dev.sh already running.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"

API=http://127.0.0.1:8080/api/v1
VICTIM=$(jq -r .VictimLendingPool < "$REPO_ROOT/config/addresses.local.json")
PAUSE_CONTROLLER=$(jq -r .PauseController < "$REPO_ROOT/config/addresses.local.json")

echo "=== Phase 2 E2E smoke ==="
echo "API:             $API"
echo "Victim:          $VICTIM"
echo "PauseController: $PAUSE_CONTROLLER"
echo ""

# 1. Health check
echo "--- /health"
curl -sf "$API/health" | jq -c '{status, redis, addresses: (.addresses|length)}'

# 2. Baseline: ensure victim is NOT paused.
echo "--- baseline: victim paused?"
paused_before=$(cast call --rpc-url http://127.0.0.1:8545 \
    "$PAUSE_CONTROLLER" "isPaused(address)(bool)" "$VICTIM")
echo "  before: $paused_before"
if [ "$paused_before" = "true" ]; then
    echo "❌ victim already paused at start; run ./scripts/stop.sh && ./scripts/dev.sh to reset"
    exit 1
fi

# 3. Trigger the demo scenario.
echo "--- POST /demo/replay-scenario"
replay=$(curl -s -X POST "$API/demo/replay-scenario")
echo "  $replay"

# 4. Poll for up to 20s for defense to mine → victim paused.
echo "--- polling for defense mined + victim paused…"
ok=false
for i in $(seq 1 40); do
    p=$(cast call --rpc-url http://127.0.0.1:8545 \
        "$PAUSE_CONTROLLER" "isPaused(address)(bool)" "$VICTIM" 2>/dev/null || echo "false")
    if [ "$p" = "true" ]; then
        ok=true
        echo "  ✓ victim paused (after $((i * 500))ms)"
        break
    fi
    sleep 0.5
done

if [ "$ok" != "true" ]; then
    echo "❌ victim never paused. Check /tmp/sentinel-logs/*"
    tail -5 /tmp/sentinel-logs/detection-engine.log 2>/dev/null || true
    tail -5 /tmp/sentinel-logs/defense-agent.log 2>/dev/null || true
    exit 1
fi

# 5. Assert the recent-events feed saw at least one DEFENSE_* event.
echo "--- /events shows defense flow"
events=$(curl -sf "$API/events" | jq -c '[.events[].kind] | unique')
echo "  kinds: $events"
echo "$events" | grep -qE "(DEFENSE_SUBMITTED|DEFENSE_MINED)" \
    || { echo "❌ no DEFENSE_* event in feed"; exit 1; }

# 6. Assert the prover binary is reachable.
echo "--- zk-prover /health"
curl -sf http://127.0.0.1:9100/health | jq -c '{status, bin: (.bin|split("/")|last)}'

echo ""
echo "✅ E2E smoke PASSED"
echo "   mempool → detection → defense-agent → PolicyRegistry.verifyAndExecute → PauseController.activate"
echo "   Victim $VICTIM is paused on-chain."
