#!/usr/bin/env bash
set -euo pipefail
POSTGRES_URL="${POSTGRES_URL:-postgresql://sentinel:sentinel@127.0.0.1:5432/sentinel}"
RETENTION_DAYS="${RETENTION_DAYS:-90}"

echo "Cleaning up audit logs older than $RETENTION_DAYS days..."
DELETED=$(psql "$POSTGRES_URL" -t -c "DELETE FROM audit_log WHERE created_at < now() - interval '${RETENTION_DAYS} days' RETURNING id;" | wc -l | tr -d ' ')
echo "Deleted $DELETED audit log entries."
