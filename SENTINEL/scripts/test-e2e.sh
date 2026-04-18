#!/usr/bin/env bash
# Docker Compose smoke test: stack becomes healthy (requires Docker).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "==> Building and starting stack..."
docker compose build
docker compose up -d
cleanup() {
  docker compose down -v 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Waiting for api-gateway health..."
for i in $(seq 1 60); do
  if curl -sf "http://localhost:8080/api/v1/health" >/dev/null; then
    echo "Gateway healthy."
    exit 0
  fi
  sleep 2
done
echo "Timeout waiting for gateway" >&2
exit 1
