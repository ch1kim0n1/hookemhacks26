#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== SENTINEL Backup ==="
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

"$REPO_ROOT/scripts/backup-postgres.sh"
echo ""
"$REPO_ROOT/scripts/backup-redis.sh"

echo ""
echo "=== Backup Complete ==="
