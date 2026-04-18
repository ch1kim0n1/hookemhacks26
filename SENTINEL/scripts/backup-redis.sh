#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups/redis}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/dump_${TIMESTAMP}.rdb"

mkdir -p "$BACKUP_DIR"

echo "Triggering Redis BGSAVE..."
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" BGSAVE >/dev/null

# Wait for save to complete
for i in $(seq 1 30); do
    SAVE_STATUS=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" LASTSAVE)
    sleep 1
    NEW_STATUS=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" LASTSAVE)
    if [ "$NEW_STATUS" != "$SAVE_STATUS" ] || [ "$i" -eq 1 ]; then
        break
    fi
done

# Copy the dump file
if docker compose ps redis >/dev/null 2>&1; then
    # Running in compose — copy from container
    docker compose cp redis:/data/dump.rdb "$BACKUP_FILE"
elif [ -f /data/dump.rdb ]; then
    cp /data/dump.rdb "$BACKUP_FILE"
else
    echo "Warning: Could not locate dump.rdb. BGSAVE was triggered but file not found."
    exit 1
fi

# Retention: keep last 7
find "$BACKUP_DIR" -name "dump_*.rdb" -mtime +7 -delete 2>/dev/null || true

BACKUP_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
echo "Redis backup complete: $BACKUP_FILE ($BACKUP_SIZE)"
