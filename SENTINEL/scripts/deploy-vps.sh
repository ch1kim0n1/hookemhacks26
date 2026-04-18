#!/usr/bin/env bash
set -euo pipefail
# Deploy SENTINEL to a VPS with Caddy for TLS
# Prerequisites: docker + docker-compose on the VPS, DNS pointing to VPS IP

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -z "${SENTINEL_DOMAIN:-}" ]; then
    echo "SENTINEL_DOMAIN is required (e.g., sentinel.example.com)"
    echo "Usage: SENTINEL_DOMAIN=sentinel.example.com ./scripts/deploy-vps.sh"
    exit 1
fi

echo "Deploying SENTINEL to ${SENTINEL_DOMAIN}..."

# Ensure .env exists
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example — review and update secrets before production use!"
fi

# Generate JWT keys if not present
./scripts/generate-jwt-keys.sh

# Build and start with production + monitoring profiles
docker compose --profile production --profile monitoring build

# Scale api-gateway for HA
API_REPLICAS="${API_REPLICAS:-2}"
docker compose --profile production --profile monitoring up -d --scale api-gateway=$API_REPLICAS

# Run migrations
echo "Running migrations..."
docker compose exec api-gateway node -e "
    const { runMigrations, getPool } = require('./dist/db.js');
    runMigrations(getPool()).then(() => process.exit(0));
" 2>/dev/null || ./scripts/migrate.sh

echo ""
echo "SENTINEL deployed!"
echo "  App:     https://${SENTINEL_DOMAIN}"
echo "  API:     https://${SENTINEL_DOMAIN}/api/v1/health"
echo "  Grafana: https://${GRAFANA_DOMAIN:-grafana.${SENTINEL_DOMAIN}}"
echo ""
echo "TLS: Caddy will auto-provision Let's Encrypt certificates."
