#!/usr/bin/env bash
# Scenario B wrapper — triggers an OPERATOR_OVERRIDE instruction.
set -euo pipefail
API="${API_BASE:-http://localhost:8080}"
curl -sSf -X POST "$API/api/v1/demo/inject-instruction" \
    -H 'content-type: application/json' \
    -d '{"reason":"demo"}' | jq .
