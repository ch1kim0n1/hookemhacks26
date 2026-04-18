#!/usr/bin/env bash
# Trigger the preemptive-strike demo flow end-to-end.
#
#   1. POST /api/v1/demo/preemptive           → seeds detection event + replays attacker tx
#   2. preemptive-strike consumes both streams:
#       - detection.confirmed → publishes signature to ThreatRegistry
#       - mempool.pending     → matches attacker+selector, calls PauseController
#   3. api-gateway forwards signature/executed events to WS clients (ImmunityMap).
#
# Usage: ./scripts/trigger-preemptive-demo.sh [API_URL]
set -euo pipefail

API_URL="${1:-http://127.0.0.1:8080}"

echo "=== Preemptive-Strike Demo ==="
echo "API: $API_URL"

response=$(curl -fsS -X POST "$API_URL/api/v1/demo/preemptive" -H "content-type: application/json" || echo '{"error":"request failed"}')
echo "$response" | jq . 2>/dev/null || echo "$response"

if echo "$response" | grep -q '"preemptive":true'; then
    echo
    echo "✅ Preemptive flow triggered."
    echo "   → Watch sentinel.preemptive.signature / sentinel.preemptive.executed on the WS firehose,"
    echo "   → Or the ImmunityMap panel in the frontend (/demo route)."
else
    echo
    echo "⚠️  Preemptive demo returned non-success response (see above)."
    exit 1
fi
