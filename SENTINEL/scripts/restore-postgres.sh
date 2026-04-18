#!/usr/bin/env bash
set -euo pipefail
BACKUP_FILE="${1:-}"
POSTGRES_URL="${POSTGRES_URL:-postgresql://sentinel:sentinel@127.0.0.1:5432/sentinel}"

if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: $0 <backup-file.sql.gz>"
    echo ""
    echo "Available backups:"
    ls -lht backups/postgres/*.sql.gz 2>/dev/null || echo "  (none found)"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: $BACKUP_FILE not found"
    exit 1
fi

echo "WARNING: This will DROP and recreate the sentinel database."
echo "Backup file: $BACKUP_FILE"
read -p "Continue? (yes/no) " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

echo "Restoring from $BACKUP_FILE..."

# Drop and recreate database
psql "${POSTGRES_URL%/*}/postgres" -c "DROP DATABASE IF EXISTS sentinel;" -c "CREATE DATABASE sentinel OWNER sentinel;"

# Restore
gunzip -c "$BACKUP_FILE" | psql "$POSTGRES_URL" -q

echo "Postgres restore complete."
echo "Run ./scripts/migrate.sh to apply any pending migrations."
