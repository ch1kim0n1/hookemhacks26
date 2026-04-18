#!/usr/bin/env bash
# Quick check that production services are healthy
set -euo pipefail

DOMAIN="${SENTINEL_DOMAIN:-localhost}"
SCHEME="https"
if [ "$DOMAIN" = "localhost" ]; then SCHEME="http"; fi

echo "Checking SENTINEL production health..."

# API health
echo -n "  API gateway: "
HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "$SCHEME://$DOMAIN/api/v1/health" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then echo "OK"; else echo "FAIL ($HTTP_CODE)"; fi

# JWKS
echo -n "  JWKS endpoint: "
HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "$SCHEME://$DOMAIN/.well-known/jwks.json" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then echo "OK"; else echo "FAIL ($HTTP_CODE)"; fi

# Frontend
echo -n "  Frontend: "
HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "$SCHEME://$DOMAIN/" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then echo "OK"; else echo "FAIL ($HTTP_CODE)"; fi

# Redis Sentinel (if production profile)
echo -n "  Redis Sentinel: "
if docker compose exec redis-sentinel-1 redis-cli -p 26379 ping >/dev/null 2>&1; then
    echo "OK"
else
    echo "N/A (dev mode)"
fi

# Grafana (if monitoring profile)
GRAFANA_DOMAIN="${GRAFANA_DOMAIN:-grafana.$DOMAIN}"
echo -n "  Grafana: "
HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "$SCHEME://$GRAFANA_DOMAIN/api/health" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then echo "OK"; else echo "N/A"; fi

echo "Done."
