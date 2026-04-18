#!/usr/bin/env bash
# Poll GET /api/v1/health for SOAK_SECONDS (default 30). Use after `pnpm dev` or compose is up.
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8080}"
SOAK_SECONDS="${SOAK_SECONDS:-30}"

echo "Soaking ${API_BASE}/api/v1/health for ${SOAK_SECONDS}s…"
for ((i = 1; i <= SOAK_SECONDS; i++)); do
    if ! curl -sf "${API_BASE}/api/v1/health" >/dev/null; then
        echo "fail at second ${i}" >&2
        exit 1
    fi
    sleep 1
done
echo "ok"
