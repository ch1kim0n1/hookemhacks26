#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups/postgres}"
POSTGRES_URL="${POSTGRES_URL:-postgresql://sentinel:sentinel@127.0.0.1:5432/sentinel}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/sentinel_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Backing up Postgres to $BACKUP_FILE..."
pg_dump "$POSTGRES_URL" | gzip > "$BACKUP_FILE"

# Retention: keep last 7 daily backups
find "$BACKUP_DIR" -name "sentinel_*.sql.gz" -mtime +7 -delete 2>/dev/null || true

BACKUP_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
echo "Backup complete: $BACKUP_FILE ($BACKUP_SIZE)"
echo "Backups in $BACKUP_DIR: $(ls "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l | tr -d ' ')"
