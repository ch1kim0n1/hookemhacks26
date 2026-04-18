#!/usr/bin/env bash
# Stop the Phase 2 dev stack launched by scripts/dev.sh.
set -u

PIDFILE=/tmp/sentinel-pids

echo "=== stopping sentinel-v2 dev stack ==="

if [ -f "$PIDFILE" ]; then
    while read -r name pid; do
        if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
            echo "  kill $name (pid=$pid)"
            kill "$pid" 2>/dev/null || true
        fi
    done < "$PIDFILE"
    rm -f "$PIDFILE"
fi

# Defense-in-depth: kill any lingering by name.
pkill -f "^anvil " 2>/dev/null || true
pkill -f "tsx watch src/index.ts" 2>/dev/null || true
pkill -f "detection_engine" 2>/dev/null || true
pkill -f "defense_agent" 2>/dev/null || true
pkill -f "vite.*host" 2>/dev/null || true

# Stop redis.
redis-cli shutdown nosave 2>/dev/null || true

echo "✅ stopped"
