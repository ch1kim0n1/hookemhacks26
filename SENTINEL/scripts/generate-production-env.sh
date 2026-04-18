#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/.env.production"

if [ -f "$OUTPUT" ]; then
    echo "WARNING: $OUTPUT already exists. Overwrite? (yes/no)"
    read -r CONFIRM
    [ "$CONFIRM" = "yes" ] || { echo "Aborted."; exit 0; }
fi

cat > "$OUTPUT" <<ENVEOF
# SENTINEL Production Environment
# GENERATED on $(date -u +%Y-%m-%dT%H:%M:%SZ) — do not commit this file
#
# Copy to .env before deploying:
#   cp .env.production .env

# --- Auth ---
SENTINEL_JWT_SECRET=$(openssl rand -hex 32)
SENTINEL_ADMIN_PASSWORD=$(openssl rand -hex 16)
SENTINEL_DEMO_TOKEN=$(openssl rand -hex 16)

# --- JWT RS256 Keys ---
# Generate with: ./scripts/generate-jwt-keys.sh
JWT_PRIVATE_KEY_PATH=./config/jwt/private.pem
JWT_PUBLIC_KEY_PATH=./config/jwt/public.pem

# --- ZK Prover ---
RISC0_DEV_MODE=0
BONSAI_API_KEY=
BONSAI_API_URL=https://api.bonsai.xyz

# --- Deployment ---
SENTINEL_DOMAIN=sentinel.example.com
GRAFANA_DOMAIN=grafana.sentinel.example.com
API_REPLICAS=2

# --- Redis (production profile uses redis-master) ---
# REDIS_URL=redis://redis-master:6379
ENVEOF

echo "Generated $OUTPUT with strong random secrets"
echo "Review and update SENTINEL_DOMAIN and BONSAI_API_KEY before deploying"
