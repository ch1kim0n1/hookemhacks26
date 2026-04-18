#!/usr/bin/env bash
# E2E test: Scenario B produces an on-chain rejection and a REJECTED cue.
# Assumes the full stack is already running. Use ./scripts/dev.sh first.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

API="${API_BASE:-http://localhost:8080}"
DEMO_TOKEN="${SENTINEL_DEMO_TOKEN:-sentinel-demo}"
REDIS_HOST=${REDIS_HOST:-127.0.0.1}
REDIS_PORT=${REDIS_PORT:-6379}

# Capture the current last-ID in the stream BEFORE injecting the event,
# so we only look at new messages produced after the trigger.
LAST_ID=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" \
    XREVRANGE sentinel.defense.rejected + - COUNT 1 2>/dev/null \
    | awk 'NR==1 {print $1}')
# If the stream doesn't exist yet, start from the beginning.
LAST_ID="${LAST_ID:-0-0}"

curl -sSf -X POST "$API/api/v1/demo/inject-instruction" -H "x-demo-token: $DEMO_TOKEN" >/dev/null

# Poll the stream for a new INVALID_PROOF entry.
found=false
for _ in $(seq 1 40); do
    MESSAGES=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" \
        XREAD COUNT 100 STREAMS sentinel.defense.rejected "$LAST_ID" 2>/dev/null || true)
    if echo "$MESSAGES" | grep -q "INVALID_PROOF"; then
        found=true
        break
    fi
    sleep 0.2
done

if [ "$found" = "true" ]; then
    echo "✅ Scenario B: INVALID_PROOF observed on sentinel.defense.rejected"
    exit 0
fi
echo "❌ Scenario B: no rejection event observed in 8s"
echo "Stream tail:"
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" XREVRANGE sentinel.defense.rejected + - COUNT 5 2>/dev/null || true
exit 1
