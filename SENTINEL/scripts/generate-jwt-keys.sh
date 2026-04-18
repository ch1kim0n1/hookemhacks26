#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_DIR="$REPO_ROOT/config/jwt"
mkdir -p "$KEY_DIR"

if [ -f "$KEY_DIR/private.pem" ]; then
    echo "JWT keys already exist at $KEY_DIR. Use scripts/rotate-jwt-keys.sh to rotate."
    exit 0
fi

echo "Generating RS256 keypair..."
openssl genrsa -out "$KEY_DIR/private.pem" 2048
openssl rsa -in "$KEY_DIR/private.pem" -pubout -out "$KEY_DIR/public.pem"
echo "Keys written to $KEY_DIR/"
