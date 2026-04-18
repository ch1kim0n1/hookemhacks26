#!/usr/bin/env bash
set -euo pipefail
BACKUP_FILE="${1:-}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"

if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: $0 <backup-file.rdb>"
    echo ""
    echo "Available backups:"
    ls -lht backups/redis/*.rdb 2>/dev/null || echo "  (none found)"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: $BACKUP_FILE not found"
    exit 1
fi

echo "WARNING: This will replace all Redis data."
echo "Backup file: $BACKUP_FILE"
read -p "Continue? (yes/no) " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

echo "Stopping Redis..."
if docker compose ps redis >/dev/null 2>&1; then
    docker compose stop redis
    docker compose cp "$BACKUP_FILE" redis:/data/dump.rdb
    docker compose start redis
else
    redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" SHUTDOWN NOSAVE 2>/dev/null || true
    cp "$BACKUP_FILE" /data/dump.rdb
    echo "Redis data file replaced. Restart Redis manually."
fi

echo "Redis restore complete."
