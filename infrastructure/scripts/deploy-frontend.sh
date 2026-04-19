#!/usr/bin/env bash
# Build the frontend, sync `frontend/dist/` to the S3 site bucket, and invalidate
# the CloudFront distribution. Reads bucket + distribution id from `terraform output`
# in envs/prod, so the env must already be applied.
#
# Usage: ./scripts/deploy-frontend.sh [--skip-build]

set -euo pipefail

PROFILE="${AWS_PROFILE_OVERRIDE:-hookem}"
REGION="${AWS_REGION_OVERRIDE:-us-east-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$INFRA_ROOT/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
DIST_DIR="$FRONTEND_DIR/dist"
ENV_DIR="$INFRA_ROOT/envs/prod"

SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing dependency: $1" >&2; exit 1; }
}
require aws
require terraform
require jq
require npm

if [ ! -d "$FRONTEND_DIR" ]; then
  echo "frontend/ not found at $FRONTEND_DIR" >&2
  exit 1
fi

if [ ! -d "$ENV_DIR/.terraform" ]; then
  echo "envs/prod has not been initialized. Run:" >&2
  echo "  cd $ENV_DIR && terraform init -backend-config=backend.hcl" >&2
  exit 1
fi

echo "==> Reading terraform outputs from envs/prod"
pushd "$ENV_DIR" >/dev/null
OUTPUTS_JSON="$(terraform output -json)"
popd >/dev/null

BUCKET="$(printf '%s' "$OUTPUTS_JSON" | jq -r '.site_bucket_name.value // empty')"
DISTRIBUTION_ID="$(printf '%s' "$OUTPUTS_JSON" | jq -r '.site_distribution_id.value // empty')"
DISTRIBUTION_DOMAIN="$(printf '%s' "$OUTPUTS_JSON" | jq -r '.site_distribution_domain.value // empty')"

if [ -z "$BUCKET" ] || [ -z "$DISTRIBUTION_ID" ]; then
  echo "terraform outputs missing site_bucket_name or site_distribution_id." >&2
  echo "Apply envs/prod first: cd $ENV_DIR && terraform apply" >&2
  exit 1
fi

echo "    bucket:        $BUCKET"
echo "    distribution:  $DISTRIBUTION_ID ($DISTRIBUTION_DOMAIN)"

if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "==> Building frontend"
  pushd "$FRONTEND_DIR" >/dev/null
  if [ ! -d node_modules ]; then
    npm install
  fi
  npm run build
  popd >/dev/null
fi

if [ ! -d "$DIST_DIR" ]; then
  echo "dist/ not found at $DIST_DIR — run without --skip-build" >&2
  exit 1
fi

echo "==> Syncing $DIST_DIR -> s3://$BUCKET"
# Long-cache immutable assets under assets/, short-cache the HTML entrypoints so a
# deploy is visible as soon as the CloudFront invalidation clears.
aws --profile "$PROFILE" --region "$REGION" s3 sync "$DIST_DIR" "s3://$BUCKET" \
  --delete \
  --exclude "*.html" \
  --cache-control "public, max-age=31536000, immutable"

aws --profile "$PROFILE" --region "$REGION" s3 sync "$DIST_DIR" "s3://$BUCKET" \
  --exclude "*" --include "*.html" \
  --cache-control "public, max-age=60, must-revalidate" \
  --content-type "text/html; charset=utf-8"

echo "==> Invalidating CloudFront"
INVALIDATION_ID="$(aws --profile "$PROFILE" cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' --output text)"
echo "    invalidation: $INVALIDATION_ID"

echo ""
echo "Deployed. URL: https://$DISTRIBUTION_DOMAIN/"
