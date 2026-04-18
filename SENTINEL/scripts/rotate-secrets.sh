#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== SENTINEL Secret Rotation ==="
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# 1. Rotate JWT keys
echo "--- JWT Keys ---"
"$REPO_ROOT/scripts/rotate-jwt-keys.sh"
echo ""

# 2. Generate new admin password
echo "--- Admin Password ---"
NEW_ADMIN_PW=$(openssl rand -hex 16)
echo "New admin password generated: ${NEW_ADMIN_PW:0:4}...${NEW_ADMIN_PW: -4}"

# Update .env file
if [ -f "$REPO_ROOT/.env" ]; then
    if grep -q "SENTINEL_ADMIN_PASSWORD" "$REPO_ROOT/.env"; then
        sed -i.bak "s/SENTINEL_ADMIN_PASSWORD=.*/SENTINEL_ADMIN_PASSWORD=$NEW_ADMIN_PW/" "$REPO_ROOT/.env"
        rm -f "$REPO_ROOT/.env.bak"
    else
        echo "SENTINEL_ADMIN_PASSWORD=$NEW_ADMIN_PW" >> "$REPO_ROOT/.env"
    fi
    echo "Updated .env"
else
    echo "WARNING: No .env file found. Set SENTINEL_ADMIN_PASSWORD=$NEW_ADMIN_PW manually."
fi

# 3. Generate new demo token
echo ""
echo "--- Demo Token ---"
NEW_DEMO_TOKEN=$(openssl rand -hex 16)
echo "New demo token generated: ${NEW_DEMO_TOKEN:0:4}...${NEW_DEMO_TOKEN: -4}"
if [ -f "$REPO_ROOT/.env" ]; then
    if grep -q "SENTINEL_DEMO_TOKEN" "$REPO_ROOT/.env"; then
        sed -i.bak "s/SENTINEL_DEMO_TOKEN=.*/SENTINEL_DEMO_TOKEN=$NEW_DEMO_TOKEN/" "$REPO_ROOT/.env"
        rm -f "$REPO_ROOT/.env.bak"
    else
        echo "SENTINEL_DEMO_TOKEN=$NEW_DEMO_TOKEN" >> "$REPO_ROOT/.env"
    fi
    echo "Updated .env"
fi

# 4. Generate new JWT secret (HS256 fallback)
echo ""
echo "--- JWT Secret (HS256 fallback) ---"
NEW_JWT_SECRET=$(openssl rand -hex 32)
if [ -f "$REPO_ROOT/.env" ]; then
    if grep -q "SENTINEL_JWT_SECRET" "$REPO_ROOT/.env"; then
        sed -i.bak "s/SENTINEL_JWT_SECRET=.*/SENTINEL_JWT_SECRET=$NEW_JWT_SECRET/" "$REPO_ROOT/.env"
        rm -f "$REPO_ROOT/.env.bak"
    else
        echo "SENTINEL_JWT_SECRET=$NEW_JWT_SECRET" >> "$REPO_ROOT/.env"
    fi
    echo "Updated .env"
fi

echo ""
echo "=== Rotation Complete ==="
echo "NOTE: Restart services to pick up new secrets:"
echo "  docker compose restart"
echo "  OR: docker compose --profile production restart"
echo ""
echo "Existing sessions with old tokens will be invalidated."
echo "Users will need to re-authenticate via /auth/token."
