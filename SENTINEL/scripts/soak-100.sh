#!/usr/bin/env bash
# Repeated health checks (default 100) against local gateway — CI-friendly smoke.
set -euo pipefail
URL="${1:-http://localhost:8080/api/v1/health}"
RUNS="${2:-100}"
ok=0
for i in $(seq 1 "$RUNS"); do
  if curl -sf "$URL" >/dev/null; then
    ok=$((ok + 1))
  else
    echo "FAIL at iteration $i" >&2
    exit 1
  fi
done
echo "OK $ok/$RUNS"
