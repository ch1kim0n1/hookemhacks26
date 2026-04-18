#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_DIR="$REPO_ROOT/config/jwt"

if [ ! -f "$KEY_DIR/private.pem" ]; then
    echo "No existing keys. Run scripts/generate-jwt-keys.sh first."
    exit 1
fi

echo "Rotating JWT keys..."
# Move current to previous (overlap period)
mv "$KEY_DIR/private.pem" "$KEY_DIR/private.previous.pem"
mv "$KEY_DIR/public.pem" "$KEY_DIR/public.previous.pem"

# Generate new
openssl genrsa -out "$KEY_DIR/private.pem" 2048
openssl rsa -in "$KEY_DIR/private.pem" -pubout -out "$KEY_DIR/public.pem"
echo "New keys generated. Previous keys kept at *.previous.pem for overlap period."
echo "After all tokens signed with old key expire, delete *.previous.pem"
