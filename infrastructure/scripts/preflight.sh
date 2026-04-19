#!/usr/bin/env bash
# Pre-apply probe: verify the `hookem` AWS profile has working access to every
# service ClawGuard's infra plan touches. Prints PASS/FAIL per service and exits
# non-zero if any required check fails. Warnings (optional-later services) don't
# fail the script.
#
# Usage: ./scripts/preflight.sh

set -u
set -o pipefail

PROFILE="${AWS_PROFILE_OVERRIDE:-hookem}"
REGION="${AWS_REGION_OVERRIDE:-us-east-1}"

# Colors (fallback to plain if stdout isn't a TTY).
if [ -t 1 ]; then
  GREEN="$(printf '\033[32m')"
  RED="$(printf '\033[31m')"
  YELLOW="$(printf '\033[33m')"
  DIM="$(printf '\033[2m')"
  RESET="$(printf '\033[0m')"
else
  GREEN=""; RED=""; YELLOW=""; DIM=""; RESET=""
fi

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

pass() { printf "  %sPASS%s %s\n" "$GREEN" "$RESET" "$1"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { printf "  %sFAIL%s %s\n" "$RED"   "$RESET" "$1"; FAIL_COUNT=$((FAIL_COUNT+1)); }
warn() { printf "  %sWARN%s %s\n" "$YELLOW" "$RESET" "$1"; WARN_COUNT=$((WARN_COUNT+1)); }
note() { printf "  %s%s%s\n" "$DIM" "$1" "$RESET"; }

section() { printf "\n%s==%s %s\n" "$DIM" "$RESET" "$1"; }

# ---- required: tooling ----------------------------------------------------
section "Local tooling"

if command -v aws >/dev/null 2>&1; then
  pass "aws CLI present ($(aws --version 2>&1 | head -n1))"
else
  fail "aws CLI not found on PATH"
fi

if command -v terraform >/dev/null 2>&1; then
  pass "terraform present ($(terraform -version | head -n1))"
else
  fail "terraform not found on PATH"
fi

if command -v jq >/dev/null 2>&1; then
  pass "jq present"
else
  warn "jq not found — preflight still runs but deploy script needs it"
fi

# ---- required: identity ---------------------------------------------------
section "AWS identity ($PROFILE / $REGION)"

CALLER_JSON="$(aws --profile "$PROFILE" --region "$REGION" sts get-caller-identity 2>&1)"
if [ $? -ne 0 ]; then
  fail "sts get-caller-identity failed — profile '$PROFILE' can't reach AWS"
  note "$CALLER_JSON"
  printf "\nAborting. Fix credentials and re-run.\n"
  exit 1
fi
ACCOUNT_ID="$(printf '%s' "$CALLER_JSON" | sed -n 's/.*"Account": *"\([^"]*\)".*/\1/p')"
ARN="$(printf '%s' "$CALLER_JSON" | sed -n 's/.*"Arn": *"\([^"]*\)".*/\1/p')"
pass "authenticated as $ARN (account $ACCOUNT_ID)"

# ---- required: S3 ---------------------------------------------------------
section "S3 (static site hosting + TF state)"
if aws --profile "$PROFILE" --region "$REGION" s3api list-buckets --query 'Buckets[0].Name' >/dev/null 2>&1; then
  pass "s3:ListAllMyBuckets"
else
  fail "s3:ListAllMyBuckets denied"
fi

# ---- required: CloudFront -------------------------------------------------
section "CloudFront (distribution + OAC)"
if aws --profile "$PROFILE" cloudfront list-distributions --max-items 1 >/dev/null 2>&1; then
  pass "cloudfront:ListDistributions"
else
  fail "cloudfront:ListDistributions denied"
fi

# Service quota: default is 200 distributions per account. 1 is fine, but surface the
# number so a throttled sandbox account doesn't surprise us.
QUOTA_CF="$(aws --profile "$PROFILE" --region us-east-1 service-quotas get-service-quota \
  --service-code cloudfront --quota-code L-24B04930 --query 'Quota.Value' --output text 2>/dev/null || true)"
if [ -n "$QUOTA_CF" ] && [ "$QUOTA_CF" != "None" ]; then
  note "CloudFront distributions quota: $QUOTA_CF"
fi

# ---- required later: Bedrock ---------------------------------------------
section "Bedrock (Haiku multimodal detection — Pillar 1)"
BEDROCK_OUT="$(aws --profile "$PROFILE" --region "$REGION" bedrock list-foundation-models \
  --query 'modelSummaries[?contains(modelId, `claude-haiku`) || contains(modelId, `claude-3-haiku`)].modelId' \
  --output text 2>&1)"
if [ $? -eq 0 ]; then
  if [ -z "$BEDROCK_OUT" ]; then
    warn "Bedrock reachable but no Haiku model visible in $REGION — request model access in console"
  else
    pass "Bedrock reachable; Haiku models visible: $(printf '%s' "$BEDROCK_OUT" | tr '\t' ',')"
  fi
else
  warn "bedrock:ListFoundationModels failed — enable the Bedrock service and grant the role"
  note "$BEDROCK_OUT"
fi

# ---- required later: KMS --------------------------------------------------
section "KMS (asymmetric secp256k1 CMK — Pillar 2)"
if aws --profile "$PROFILE" --region "$REGION" kms list-keys --limit 1 >/dev/null 2>&1; then
  pass "kms:ListKeys"
else
  warn "kms:ListKeys denied — Pillar 2 will need this"
fi

# Asymmetric secp256k1 keys count against the customer master key quota. Check it.
QUOTA_KMS="$(aws --profile "$PROFILE" --region "$REGION" service-quotas get-service-quota \
  --service-code kms --quota-code L-C2F1777E --query 'Quota.Value' --output text 2>/dev/null || true)"
if [ -n "$QUOTA_KMS" ] && [ "$QUOTA_KMS" != "None" ]; then
  note "KMS customer managed keys quota: $QUOTA_KMS"
fi

# ---- required later: Secrets Manager -------------------------------------
section "Secrets Manager (SecretsManager rotation — Pillar 2)"
if aws --profile "$PROFILE" --region "$REGION" secretsmanager list-secrets --max-results 1 >/dev/null 2>&1; then
  pass "secretsmanager:ListSecrets"
else
  warn "secretsmanager:ListSecrets denied — Pillar 2 will need this"
fi

# ---- required later: CloudWatch + SNS ------------------------------------
section "CloudWatch + SNS (logs and Slack alerts)"
if aws --profile "$PROFILE" --region "$REGION" logs describe-log-groups --limit 1 >/dev/null 2>&1; then
  pass "logs:DescribeLogGroups"
else
  warn "logs:DescribeLogGroups denied"
fi

if aws --profile "$PROFILE" --region "$REGION" cloudwatch list-metrics --max-items 1 >/dev/null 2>&1; then
  pass "cloudwatch:ListMetrics"
else
  warn "cloudwatch:ListMetrics denied"
fi

if aws --profile "$PROFILE" --region "$REGION" sns list-topics >/dev/null 2>&1; then
  pass "sns:ListTopics"
else
  warn "sns:ListTopics denied"
fi

# ---- required: IAM (can we create roles?) --------------------------------
section "IAM (policies underneath everything)"
if aws --profile "$PROFILE" iam list-roles --max-items 1 >/dev/null 2>&1; then
  pass "iam:ListRoles"
else
  fail "iam:ListRoles denied — can't provision service roles"
fi

# ---- summary --------------------------------------------------------------
printf "\n%s== summary ==%s  %sPASS%s %d  %sWARN%s %d  %sFAIL%s %d\n" \
  "$DIM" "$RESET" "$GREEN" "$RESET" "$PASS_COUNT" "$YELLOW" "$RESET" "$WARN_COUNT" "$RED" "$RESET" "$FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  printf "\n%sOne or more required checks failed. Resolve before running terraform apply.%s\n" "$RED" "$RESET"
  exit 1
fi

if [ "$WARN_COUNT" -gt 0 ]; then
  printf "\n%sWarnings are for services imported for 'later' pillars.%s\n" "$YELLOW" "$RESET"
  printf "%sThe S3+CloudFront static site can proceed.%s\n" "$YELLOW" "$RESET"
fi

exit 0
