# ClawGuard Infrastructure

Terraform for the AWS side of ClawGuard. Region: `us-east-1`. AWS profile: `hookem`.

## Layout

```
infrastructure/
├── scripts/
│   ├── preflight.sh          # pre-apply access + quota probe
│   └── deploy-frontend.sh    # build frontend, sync to S3, invalidate CF
├── backend-bootstrap/        # creates the S3 bucket + DynamoDB table used as the TF backend
├── modules/
│   ├── preflight/            # TF-level data-source probe (fails at plan time if auth is broken)
│   └── static-site/          # S3 (private) + CloudFront + OAC + HTTP→HTTPS redirect
└── envs/
    └── prod/                 # single env for now. Uses the S3 backend.
```

## Current scope

**Live today:** S3 + CloudFront static site hosting for the landing page in `../frontend/`.

**Imported for later (not yet provisioned here):** Bedrock (Haiku multimodal detection), KMS asymmetric CMK + Secrets Manager for transaction signing, CloudWatch + SNS alerting, IAM. See the project root `CLAUDE.md` for how these map onto the detection pipeline and `skill/chain/client.py`.

## First-time setup

```bash
# 0. Verify you can actually talk to every service ClawGuard needs.
./scripts/preflight.sh

# 1. Create the state backend (S3 bucket + DynamoDB lock table).
#    This root module uses LOCAL state — check in the resulting .tfstate at your own risk
#    (it only describes the state bucket itself; no secrets). Usually you keep it local.
cd backend-bootstrap
terraform init
terraform apply
# Note the bucket name + table name in the outputs.
cd ..

# 2. Point env at the backend. Copy outputs into envs/prod/backend.hcl (see the example).
cp envs/prod/backend.hcl.example envs/prod/backend.hcl
$EDITOR envs/prod/backend.hcl

# 3. Apply the env.
cd envs/prod
terraform init -backend-config=backend.hcl
terraform apply

# 4. Build + deploy the static site.
cd ../..
./scripts/deploy-frontend.sh
```

## Day-to-day

```bash
# Plan/apply changes
cd envs/prod && terraform plan

# Re-deploy the site after a frontend change
./scripts/deploy-frontend.sh
```

## Why this shape

- **Profile-pinned provider.** `profile = "hookem"` is set in `envs/prod/providers.tf`. There is no AWS credential fallback — if the profile is missing, TF fails loudly.
- **Backend bootstrap is a separate root module** because the state bucket can't hold its own state. Standard chicken-and-egg pattern.
- **OAC, not OAI.** CloudFront Origin Access Control is the supported replacement for Origin Access Identity. The S3 bucket is fully private; only the CloudFront distribution can read it.
- **No WAF, no custom domain yet.** The distribution uses the default `*.cloudfront.net` hostname. When a Route53 hosted zone is ready, set `aliases` and `acm_certificate_arn` on the `static-site` module.

## Adding a Route53 domain later

1. Create the hosted zone (outside this repo or in a new `dns/` module).
2. Request an ACM cert **in us-east-1** for the apex and `www.` (CloudFront requires us-east-1 certs).
3. In `envs/prod/terraform.tfvars` set:
   ```hcl
   site_aliases             = ["example.com", "www.example.com"]
   site_acm_certificate_arn = "arn:aws:acm:us-east-1:<acct>:certificate/<id>"
   ```
4. `terraform apply` and then add the A/AAAA ALIAS records pointing at the distribution.
