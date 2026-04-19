#!/usr/bin/env bash
# One-shot deploy of the 14-node + 2-validator ClawGuard fabric.
#
#   1. Ensure the ECR image is pushed (rebuilds if the local image digest is
#      missing or corrupt — Docker Desktop on macOS occasionally I/Os out on
#      large multi-layer pushes).
#   2. terraform apply (envs/prod).
#   3. Capture `fabric_alb_dns`.
#   4. Build the frontend with VITE_API_BASE_URL pointing at the ALB.
#   5. Deploy the frontend to the existing CloudFront distribution.
#
# Usage: ./scripts/deploy-fabric.sh
#
# Requires: AWS creds (aws sts get-caller-identity must already succeed),
# docker buildx, terraform, jq, npm.

set -euo pipefail

PROFILE="${AWS_PROFILE_OVERRIDE:-hookem}"
REGION="${AWS_REGION_OVERRIDE:-us-east-1}"
ACCOUNT_ID="235921997878"
IMAGE_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/clawguard-fabric:v1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$INFRA_ROOT/.." && pwd)"
ENV_DIR="$INFRA_ROOT/envs/prod"

require() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }
require docker
require terraform
require jq
require aws
require npm

echo "==> Checking AWS identity"
aws --profile "$PROFILE" sts get-caller-identity --query 'Arn' --output text

echo "==> Ensuring ECR repo exists"
aws --profile "$PROFILE" --region "$REGION" ecr describe-repositories \
  --repository-names clawguard-fabric >/dev/null 2>&1 \
  || aws --profile "$PROFILE" --region "$REGION" ecr create-repository \
        --repository-name clawguard-fabric \
        --image-scanning-configuration scanOnPush=true >/dev/null

echo "==> ECR login"
aws --profile "$PROFILE" --region "$REGION" ecr get-login-password \
  | docker login --username AWS --password-stdin \
    "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# If ECR already has v1 we skip the rebuild — image is immutable.
if aws --profile "$PROFILE" --region "$REGION" ecr describe-images \
    --repository-name clawguard-fabric --image-ids imageTag=v1 \
    >/dev/null 2>&1; then
  echo "==> ECR already has clawguard-fabric:v1 — skipping build"
else
  echo "==> Building + pushing $IMAGE_URI (linux/amd64)"
  pushd "$REPO_ROOT" >/dev/null
  docker buildx build \
    --platform linux/amd64 \
    -t "$IMAGE_URI" \
    --push .
  popd >/dev/null
fi

echo "==> terraform init + apply in $ENV_DIR"
terraform -chdir="$ENV_DIR" init -upgrade -input=false
terraform -chdir="$ENV_DIR" apply -auto-approve -input=false

echo "==> Capturing outputs"
OUTPUTS_JSON="$(terraform -chdir="$ENV_DIR" output -json)"
ALB_DNS="$(printf '%s' "$OUTPUTS_JSON" | jq -r '.fabric_alb_dns.value // empty')"
CF_DOMAIN="$(printf '%s' "$OUTPUTS_JSON" | jq -r '.site_distribution_domain.value // empty')"

if [ -z "$ALB_DNS" ]; then
  echo "fabric_alb_dns missing from terraform outputs" >&2
  exit 1
fi
echo "    ALB: http://$ALB_DNS"
echo "    CF : https://$CF_DOMAIN"

echo "==> Waiting for one node to become healthy"
for i in $(seq 1 60); do
  if curl -fsS -m 5 "http://$ALB_DNS/n/peer-a0/api/health" >/dev/null 2>&1; then
    echo "    peer-a0 is up"
    break
  fi
  printf '.'
  sleep 5
done
echo

echo "==> Topology probe"
curl -fsS "http://$ALB_DNS/n/peer-a0/api/network/topology" \
  | jq '{self_id, source, node_count: (.nodes | length), edge_count: (.edges | length)}' \
  || echo "(topology not yet ready — dashboard will reconnect)"

echo "==> Building frontend with VITE_API_BASE_URL=http://$ALB_DNS"
pushd "$REPO_ROOT/frontend" >/dev/null
VITE_API_BASE_URL="http://$ALB_DNS" npm run build
popd >/dev/null

echo "==> Shipping frontend"
"$SCRIPT_DIR/deploy-frontend.sh" --skip-build

echo ""
echo "Done."
echo "  Dashboard : https://$CF_DOMAIN/"
echo "  API root  : http://$ALB_DNS/n/peer-a0/"
