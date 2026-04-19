# Running the ClawGuardian live demo

Three ways to run the dashboard so the data on screen is real, not mock.
Pick the one that matches your setup. In every mode you can flip the
**kill switch** in the topbar to force mock data on — click the live
chip next to the user menu.

---

## Mode A — local API + local dashboard (fastest, no AWS needed)

This is the default dev loop. Nothing leaves your laptop.

```bash
# one-time
make setup

# terminal 1 — the backend
make api           # uvicorn on http://localhost:8000

# terminal 2 — the dashboard
make dashboard     # vite on http://localhost:5175

# terminal 3 — generate live traffic so the dashboard has something to show
make demo          # hammers /api/scan with the fixture attacks
```

Open <http://localhost:5175/dashboard.html>. The live chip in the topbar
should turn **blue** within ~5 seconds; detections start landing on the
Overview and Attacks tabs as the demo agent fires payloads.

If the chip stays grey:

- Make sure `/api/health` returns 200 (`curl localhost:8000/api/health`).
- If CORS is blocking, set `CORS_ORIGINS=http://localhost:5175` in the
  backend env and restart.

The frontend defaults to `http://localhost:8000` via
`frontend/src/lib/api.js` → `apiBaseUrl()`. Override with
`VITE_API_BASE_URL` at build time to point at a different origin.

**Kill switch:** click the topbar live chip. The dashboard drops to mock
data, the backend keeps running — useful if anything goes sideways
on-stage. Click again to resume live polling.

---

## Mode B — deployed API + local dashboard (for the judge-facing URL)

When the backend is already on AWS (ECS Fargate + API Gateway) but you
want to iterate on the dashboard locally:

```bash
export VITE_API_BASE_URL=https://<your-api-gw-id>.execute-api.us-east-1.amazonaws.com
export VITE_API_ADMIN_TOKEN=<admin-token-from-secrets-manager>

make dashboard
```

If `/api/audit`, `/metrics`, or `/ws/updates` are needed from the SPA,
set `clawguardian.api.token` in localStorage (or `VITE_API_ADMIN_TOKEN`
at build time) to a value that matches `CLAWGUARD_ADMIN_TOKEN` on the
server. Rate-limit defaults apply — the per-IP quota is visible at
`/api/health`.

---

## Mode C — full cloud deploy (what the judges open)

### Prereqs

- `aws-vault` or SSO configured for the target account
- Terraform ≥ 1.7
- Node 20, Python ≥ 3.11, `uv`

### One-time: bootstrap backend state

```bash
cd infrastructure/backend-bootstrap
terraform init
terraform apply   # creates the tf-state S3 bucket + DynamoDB lock table
```

### Stand up the stack

```bash
cd infrastructure/envs/prod
terraform init
terraform apply -var='enable_compute=true'
```

This brings up: VPC + PrivateLink endpoints, ECS cluster + Fargate
service (3 tasks), API Gateway, Cognito user pool, KMS signer key, KMS
envelope key, Secrets Manager secret + rotation Lambda, S3 + CloudFront
for the SPA.

Outputs you will need:

- `api_gateway_url`
- `cloudfront_domain`
- `cognito_user_pool_id`, `cognito_client_id`
- `kms_signer_key_id`, `envelope_kms_key_id`

### Seed the secrets

```bash
aws secretsmanager put-secret-value \
  --secret-id clawguard/prod/runtime \
  --secret-string '{
    "ANTHROPIC_API_KEY": "sk-ant-…",
    "BASE_RPC_URL": "https://sepolia.base.org",
    "CLAWGUARD_ADMIN_TOKEN": "<32-byte hex>",
    "SLACK_WEBHOOK_URL": ""
  }'
```

### Build + deploy the SPA

```bash
cd frontend
VITE_API_BASE_URL=https://<api-gw>.execute-api.us-east-1.amazonaws.com \
VITE_COGNITO_USER_POOL_ID=<pool-id> \
VITE_COGNITO_CLIENT_ID=<client-id> \
  npm run build

cd ..
infrastructure/scripts/deploy-frontend.sh   # aws s3 sync + cloudfront invalidate
```

Open `https://<cloudfront_domain>/dashboard.html`.

---

## Verifying the live chips

The AWS tab uses `/api/aws/status` to decide which service cards show
**LIVE** vs **DEMO**. A card flips to LIVE when the backend sees the
matching env var:

| Card            | Env the backend reads                  |
| --------------- | -------------------------------------- |
| KMS signer      | `CLAWGUARD_KMS_KEY_ID`                 |
| KMS envelope    | `CLAWGUARD_ENVELOPE_KMS_KEY_ID`        |
| Secrets Manager | `CLAWGUARD_SECRETS_SOURCE=aws`         |
| Bedrock         | always reports model id (enabled=true) |
| API Gateway     | `CLAWGUARD_API_GATEWAY_URL`            |
| Cognito         | `CLAWGUARD_COGNITO_USER_POOL_ID`       |
| ECS Fargate     | `CLAWGUARD_ECS_CLUSTER`                |

Terraform sets these for the prod ECS task definition automatically.
Locally you can override them in `.env` if you want the cheat-sheet to
reflect a cloud deployment even when the API is running on your laptop.

---

## Showing secure practices (the demo moment)

Open devtools with the dashboard live and you should see:

1. No bearer tokens in query strings — only `X-Admin-Token` headers on
   privileged calls.
2. CSP header present on every response (`curl -I /api/health` or the
   Network tab).
3. `/api/aws/status` returns the signer's derived EVM address; paste it
   into Basescan (`https://sepolia.basescan.org/address/<addr>`) to see
   real transactions signed by the KMS key.
4. `/api/chain/validators` shows the last 8 block producers — proof the
   backend is reading a real chain RPC, not a mock.
5. Rate limit headers (`X-RateLimit-*`, `Retry-After`) appear after
   ~60 rapid requests.

If any of those break mid-demo, hit the kill switch. The dashboard
reverts to the mock pool and stays on brand.
