#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

POSTGRES_URL="${POSTGRES_URL:-postgresql://sentinel:sentinel@127.0.0.1:5432/sentinel}"

echo "Running migrations against $POSTGRES_URL..."
for f in "$REPO_ROOT/services/api-gateway/migrations"/*.sql; do
    echo "  $(basename "$f")"
    psql "$POSTGRES_URL" -f "$f" -q
done
echo "Migrations complete."
