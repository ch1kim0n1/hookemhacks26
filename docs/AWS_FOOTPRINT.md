# AWS footprint — judge Q&A cheat sheet

Every AWS service used in this repo, why we picked it over alternatives, and the
lines of Terraform/code that prove it. Use this as the script for the
architecture portion of the judge demo.

## TL;DR

ClawGuard runs on AWS as a **decentralised mesh of 14 peer nodes + 2 validators**
— each a separate ECS Fargate task in its own CloudWatch log group, all fronted
by a single ALB that routes `/n/{node_id}/*` to that node's target group. The
SPA is static on CloudFront + S3. Secrets live in Secrets Manager. Signing
keys live in KMS HSMs and can't be exfiltrated. The signed threat intel
lands on Base Sepolia (chain id 84532) — AWS provides the compute, the chain
provides the trust root.

## Why Fargate (the top judge question)

> "Real users running OpenClaw agents deploy ClawGuard as a sidecar next to
> their agent. We simulate that on Fargate — each of the 14 tasks **is** one
> operator's isolated node with its own process, IP, logs, and IAM role. Not
> 14 Lambdas pretending to be nodes."

Specific reasons:

1. **Per-tenant isolation matches production.** Each Fargate task is one tenant.
   Clickable in the ECS console. One log group per node. This is what a real
   deployment looks like — we didn't downgrade to a single-process simulator.
2. **Always warm.** No cold start. The judge clicks a node in the dashboard
   and gets a response in a dozen ms. Lambda cold starts on a 1.4 GiB container
   with a DeBERTa classifier would be 8–15 s each, the demo would feel fake.
3. **Long-lived state.** The Alembic-gated API needs a warm process, cached
   classifier weights, a running chain poller, and active Anthropic TCP
   connections. Lambda's lifecycle is wrong for that.
4. **Observable.** `aws ecs list-tasks` shows 14 rows. `/n/peer-a0/api/health`
   returns live JSON. The topology the dashboard renders is the actual output
   of `/api/network/topology` on one of those tasks.
5. **Cost stays honest.** Fargate Spot (~70% off) on `256 CPU / 512 MiB` tasks.
   14 nodes ≈ \$1–2 / day. The free-tier credits cover the hackathon.

## The 14 + 2 mesh topology

Baked into every task's environment as `CLAWGUARD_TOPOLOGY_JSON` — so every
node can answer `/api/network/topology` with the same graph.

```
group A (6 peers · us-east-1)         group B (6 peers · eu-west-1)
  peer-a0 ─┐                            peer-b0 ─┐
  peer-a1 ─┤  ring (+1)                 peer-b1 ─┤  ring (+1)
  peer-a2 ─┤  chord (+3)   →   ←        peer-b2 ─┤  chord (+3)
  peer-a3 ─┤                            peer-b3 ─┤
  peer-a4 ─┤                            peer-b4 ─┤
  peer-a5 ─┘                            peer-b5 ─┘
         ↓ validator-north                   ↓ validator-south
         us-east-1                           ap-southeast-1
```

- **Max 3 outbound per peer**: `(i+1)%6` + `(i+3)%6` + own-group validator.
- **Cross-group** gossip goes via validators — peers never link across groups
  directly, so the graph shows two visible clusters bridged at the top/bottom.
- Terraform enforces the 3-outbound cap at plan time
  (`validation` block in `infrastructure/modules/fabric/variables.tf`).

## AWS services actually in use

| Service | Purpose | Wired in |
|---|---|---|
| **ECS Fargate** (+ Fargate Spot) | The 14 + 2 nodes. One ECS service per node, identical image, differentiated env vars. | `infrastructure/modules/fabric/main.tf` `aws_ecs_task_definition.node` / `aws_ecs_service.node` |
| **ECR** | Holds the single `clawguard-fabric:v1` image. Same bits run on every node. | `235921997878.dkr.ecr.us-east-1.amazonaws.com/clawguard-fabric:v1` |
| **Application Load Balancer (ALB)** | One listener; one listener-rule per node routes `/n/{node_id}/*` to that node's target group. Fixed `404 JSON` default. | `aws_lb_listener.http` + `aws_lb_listener_rule.node` |
| **VPC + 2 public subnets + IGW** | Tasks run in public subnets with public IPs so they can pull ECR without a NAT Gateway (saves \$1.05/day). Security groups restrict inbound to the ALB SG only. | `aws_vpc.this`, `aws_subnet.public`, `aws_security_group.tasks` |
| **CloudWatch Logs** | 14 log groups — `/aws/ecs/clawguard-fabric/{node_id}` — 3-day retention. Every node's stdout/stderr is independently searchable. | `aws_cloudwatch_log_group.node` |
| **IAM** | One exec role (ECR pull + log write) and one task role (`sts:GetCallerIdentity` only) shared by all tasks. No wildcard actions. | `aws_iam_role.exec`, `aws_iam_role.task` |
| **CloudFront + S3 (static-site module)** | Dashboard SPA. CloudFront distribution → Origin Access Control → private S3 bucket. TLS, invalidation-driven deploys, SPA 403/404 → `index.html`. | `infrastructure/modules/static-site` |
| **Cognito** | Dashboard auth. User pool with mandatory TOTP MFA. | `infrastructure/modules/cognito` |
| **KMS envelope + KMS signer** | `envelope-kms` seals sensitive audit rows; `node-signer` is an HSM-resident secp256k1 key used by `sign_tx` Lambda so the chain signer never lives in a container. | `infrastructure/modules/envelope-kms`, `infrastructure/modules/node-signer` |
| **Secrets Manager** | Anthropic API key, admin bearer token, Slack webhook. 30-day rotation via a dedicated Lambda. | `infrastructure/modules/secrets` |
| **Bedrock** | Optional "run the Claude judge inside the tenant's own AWS account" path. Same Claude model, different delivery. | `skill/detectors/judge.py` + `infrastructure/modules/preflight` |
| **API Gateway (Pillar-2 surface)** | SigV4-authenticated edge in front of the node mesh. Not on the default demo path; exercised by the agent-mTLS flow. | `infrastructure/modules/api-gateway` |
| **DynamoDB** | **One** table, one column: Terraform state lock. Not used for application state. | `infrastructure/backend-bootstrap` |
| **S3 (state)** | Remote Terraform state, TLS-only bucket policy, versioned. | `infrastructure/backend-bootstrap` |
| **STS** | Task role hands out short-lived creds; `/api/aws/status` returns the caller identity so the dashboard can prove it's running with a real AWS principal. | `skill.chain.aws_status` |

## Daily cost (steady state)

| Item | Day cost |
|---|---|
| 14 × Fargate Spot `256 CPU / 512 MiB` | ~\$1.20 |
| ALB + 14 target groups | ~\$0.60 |
| CloudFront egress (demo traffic) | <\$0.01 |
| CloudWatch Logs (3-day retention, ~20 MiB/day/node) | ~\$0.05 |
| ECR storage (one 300 MiB image) | <\$0.01 |
| KMS keys ($1/mo each × 2) | ~\$0.07 |
| Secrets Manager ($0.40/mo × N secrets) | ~\$0.02 |
| **Total** | **~\$2.00 / day** |

## The things that are NOT AWS (and why)

- **Threat registry lives on-chain**, not in DynamoDB. A judge can verify any
  intel row on a public block explorer (Basescan). Putting it in DynamoDB
  would reintroduce a private-state dependency — the whole point of the chain
  cache is that it's cryptographically open.
- **Chain RPC is `https://sepolia.base.org`** (public). If judges ask about
  RPC provider lock-in: the module takes `BASE_SEPOLIA_RPC_URL` as an env var
  so a tenant can point at Alchemy, Infura, their own node — anything.
- **The classifier is local Python** (DeBERTa-v3), baked into the image. Not
  SageMaker. Reason: ~12 ms p50 inference on CPU, no inference-endpoint
  latency floor, no per-request billing.

## Talking-point ladder (if a judge asks "are you actually using X")

> **"How do I know this is really decentralised?"**
> Click any node on the propagation graph. Then curl
> `$ALB/n/peer-b3/api/network/topology` and you'll see the same 14-node
> answer, served by a different Fargate task (different log stream, different
> IP). Each task ran through Alembic-migrations to 503-gate its own DB before
> `/api/ready` flipped to 200.

> **"Why 14, not 3?"**
> 6 + 6 peers gives visible geographic spread (we label group A us-east-1,
> group B eu-west-1 for the dashboard) and enough density to demonstrate a
> ring+chord gossip pattern with the max-3 outbound constraint. 2 validators
> are the minimum for "different regions can sign." Fewer looks contrived;
> more would be theater.

> **"Why not Lambda?"**
> Cold start on a 1.4 GiB container with a ML model would be 8–15 s each —
> the demo would pause every 15 min when the warm invocation timed out. Also
> Lambda's 15-min ceiling doesn't fit the Alembic migration gate, the chain
> poller, and the audit-log flush cycle.

> **"What's the blast radius if one Fargate task is RCE'd?"**
> The task role only has `sts:GetCallerIdentity` + `logs:Put*`. It cannot
> sign a transaction (that's behind a separate Lambda with its own role that
> talks to KMS). It cannot read other tenants' logs. It cannot touch S3 or
> Secrets Manager from this role. One node is compromised — the other 13
> keep gossipping around it.

## Where the code proves each claim

- **14 nodes, not fake**: `infrastructure/envs/prod/fabric.tf` lines 28-82
  (local `fabric_nodes` map), then `aws_ecs_service.node` in the module.
- **Max-3 constraint**: `infrastructure/modules/fabric/variables.tf`
  `validation { condition = alltrue([for _, n in var.nodes : length(n.peer_ids) <= 3]) }`
- **Topology source of truth**: `skill/topology.py`
  (`_load_topology_from_env`) + module `locals.topology_json`.
- **Path-prefix middleware**: `skill/api.py` `PathPrefixMiddleware` — strips
  `CLAWGUARD_PATH_PREFIX` so one ALB can multiplex 14 backends on one listener.
- **Live dashboard graph**: `frontend/src/lib/adapters.js` `resolveTopology` +
  `frontend/src/components/dashboard/views/registry.js` `layoutNodes` — the
  nodes on screen are the nodes returned by `/api/network/topology`, not
  hardcoded.
