# ClawGuard on AWS — Architecture

> The 30-second pitch: **ClawGuard is decentralised security middleware for OpenClaw agents. Three Fargate validator nodes live in private subnets, sign Base Sepolia transactions with non-exportable KMS keys, talk to a SigV4-authenticated API Gateway, and judge prompt injections with Claude Haiku 4.5 on Bedrock. No Ethereum private key ever touches disk or memory.**

## The story the diagram tells

```
        ┌──────────────────────────────────────────────────────────────────────┐
        │                  ClawGuard AWS account (hookem, us-east-1)           │
        │                                                                      │
        │   ┌────────────┐       ┌────────────────────┐    ┌──────────────┐    │
        │   │  Cognito   │──┐    │  S3 (private) +    │    │  CloudFront  │    │
        │   │  (TOTP MFA)│  │    │  OAC (no public    │◀──▶│  + WAFless   │    │
        │   └────────────┘  │    │   read access)     │    │   demo CDN   │    │
        │                   │    └────────────────────┘    └──────┬───────┘    │
        │                   │                                     │            │
        │                   └─── Hosted-UI login URL ◀────── judges' browser   │
        │                                                                      │
        │   ┌───────────────── Pillar 2: secure-by-default core ───────────┐   │
        │   │                                                              │   │
        │   │   ┌───────────┐    ┌──────────────────┐    ┌─────────────┐   │   │
        │   │   │  Envelope │───▶│ Secrets Manager  │◀──▶│  Rotation   │   │   │
        │   │   │   KMS CMK │    │  admin / metrics │    │  Lambda     │   │   │
        │   │   │  (yearly  │    │  / ws-token      │    │  (30 days)  │   │   │
        │   │   │  rotation)│    └──────────────────┘    └─────────────┘   │   │
        │   │   └─────┬─────┘                                              │   │
        │   │         │ encrypts                                           │   │
        │   │         ▼                                                    │   │
        │   │   ┌─────────────────────── VPC (10.42.0.0/16) ───────────┐   │   │
        │   │   │                                                      │   │   │
        │   │   │   Private subnets (az1, az2) ── no public IPs        │   │   │
        │   │   │                                                      │   │   │
        │   │   │   ┌───────┐ ┌───────┐ ┌───────┐                      │   │   │
        │   │   │   │ Node A│ │ Node B│ │ Node C│  Fargate tasks       │   │   │
        │   │   │   │ Fargate│ │Fargate│ │Fargate│  (1 per node)       │   │   │
        │   │   │   └───┬───┘ └───┬───┘ └───┬───┘                      │   │   │
        │   │   │       │ SigV4   │         │                          │   │   │
        │   │   │       ▼                                              │   │   │
        │   │   │   PrivateLink endpoints  ─ kms, secretsmanager,      │   │   │
        │   │   │                            bedrock-runtime, logs,    │   │   │
        │   │   │                            ecr.*, execute-api, sts   │   │   │
        │   │   │       │                                              │   │   │
        │   │   │       └──▶ 1 × NAT GW ── Base Sepolia RPC only       │   │   │
        │   │   └──────────────────────────────────────────────────────┘   │   │
        │   │                                                              │   │
        │   │   Per-node KMS ECC_SECG_P256K1 signing keys (A, B, C)        │   │
        │   │   │  key_usage = SIGN_VERIFY — non-exportable, HSM-bound     │   │
        │   │   │  IAM: only that node's task role has kms:Sign            │   │
        │   │                                                              │   │
        │   │   API Gateway HTTP API v2 (AWS_IAM authorizer)               │   │
        │   │   ├─ POST /sign   → Lambda (uses KMS:Sign on node keys)      │   │
        │   │   └─ POST /detect → Lambda (Bedrock converse, Haiku 4.5)     │   │
        │   │                                                              │   │
        │   │   CloudWatch Logs + SNS alerts on SignFailures / Throttles   │   │
        │   └──────────────────────────────────────────────────────────────┘   │
        └──────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                        ╔════════════════════════╗
                        ║  Base Sepolia (84532)  ║
                        ║  ThreatRegistry +      ║
                        ║  DefenseProtocol       ║
                        ╚════════════════════════╝
```

## The three answers judges will ask for

### 1. "What stops someone stealing the signing key?"

**There is no key to steal.** Each node has an AWS KMS key with `key_usage = SIGN_VERIFY` and `customer_master_key_spec = ECC_SECG_P256K1`. KMS keys of that kind are non-exportable — the AWS API literally has no operation that can return the private material. Signing is done with `kms:Sign`; the node never sees the secret. A compromised container reveals the signing *oracle* (bounded by IAM), not the key.

The Ethereum address is deterministic: `address = keccak256(uncompressed_pubkey[X||Y])[-20:]`. Everyone can verify the node's identity by calling `kms:GetPublicKey` — but no one, including ClawGuard operators, can extract the private material.

**On rotation:** the *envelope* KMS key that encrypts Secrets Manager has `enable_key_rotation = true` (365-day automatic rotation). Bearer tokens rotate every 30 days via a Secrets Manager rotation Lambda with a 4-step handshake (`createSecret → setSecret → testSecret → finishSecret`). The Ethereum signing key is never rotated, because rotating an asymmetric KMS key changes the derived Ethereum address and therefore the node's on-chain reputation — the right property here is *non-exportability*, not *rotation*.

### 2. "What stops someone calling your API directly?"

**SigV4.** The API Gateway HTTP API v2 uses `authorization_type = AWS_IAM`. Every request must be signed by the caller's IAM principal with the AWS Signature v4 algorithm, over the HTTP verb, path, canonical querystring, canonical headers, and hashed body. API Gateway rejects anything that doesn't verify.

Only the three node task roles have `execute-api:Invoke` on the API resource. There is no API key, no bearer token to leak, and no public route. In defence-in-depth terms: even if a node were compromised and leaked its temporary credentials, the credentials expire in ~6 hours, come from STS via the Fargate metadata service (not from disk), and the KMS signing key is still bound by its own `kms:Sign` resource scope to that single node's key.

### 3. "What stops someone sniffing traffic between nodes and AWS?"

**The traffic never leaves AWS's network.** Nodes run in private subnets with no public IPs. All AWS API traffic is routed through PrivateLink interface endpoints (`kms`, `secretsmanager`, `bedrock-runtime`, `logs`, `ecr.api`, `ecr.dkr`, `execute-api`, `sts`) plus an S3 gateway endpoint. A single NAT Gateway exists only so Base Sepolia RPC (a public-internet endpoint we don't control) is reachable.

VPC endpoint policies + security groups: only the task SG can send 443 to the endpoints; nothing else in the VPC can. TLS terminates at the AWS API, not at a NAT or proxy — there is no MITM surface on the wire.

## Component map

| Service | Terraform module | Role |
|---|---|---|
| S3 (private) + CloudFront + OAC | `modules/static-site` | Landing page + judge-demo frontend |
| Cognito user pool (TOTP MFA) | `modules/cognito` | Judge login |
| KMS `alias/clawguard-envelope` (symmetric, yearly rotation) | `modules/envelope-kms` | Encrypts Secrets Manager material and off-chain payloads |
| KMS `alias/clawguard-node-{a,b,c}` (asymmetric ECC_SECG_P256K1) | `modules/node-signer` | Per-node Ethereum signing oracle |
| Secrets Manager (admin / metrics / ws tokens) | `modules/secrets` | Bearer-token store, encrypted under envelope CMK |
| Rotation Lambda | `modules/rotation-lambda` | Rotates bearer tokens every 30 days |
| Bedrock managed policy | `modules/bedrock` | `bedrock:InvokeModel` on Claude Haiku 4.5 |
| API Gateway HTTP API v2 + detect / sign Lambdas | `modules/api-gateway` | SigV4-gated detector + signer |
| VPC + PrivateLink endpoints + NAT | `modules/network` | Private subnets for nodes |
| ECR + ECS Fargate cluster + 3 services | `modules/nodes` | The three decentralised validator nodes |
| CloudWatch + SNS alarms | `modules/observability` | SignFailures / DetectErrors / Throttles |

## Where the encryption lives

- **Threat hashes (public):** SHA-256 hashes of attack fingerprints are published on Base Sepolia in cleartext. The hash is already one-way — publishing it reveals nothing about the attack content, but every node can match against it.
- **Bearer tokens and off-chain defense updates (encrypted):** encrypted client-side with AES-256-GCM, key material comes from `kms:GenerateDataKey` on the envelope CMK. The wrapped data key travels with the ciphertext; only node task roles + the rotation Lambda role can `kms:Decrypt` it.
- **Secrets Manager at rest:** every secret is `KmsKeyId`-bound to the envelope CMK. Without access to that KMS key, raw Secrets Manager ciphertext is useless.
- **Ethereum private key:** never exists in cleartext anywhere. HSM-bound inside KMS.

## Cost gating

`enable_compute = false` is the default. That skips the VPC (2 × NAT + 8 × PrivateLink endpoints ≈ $85/mo) and the 3 × Fargate tasks. The secure-by-default core (KMS, Secrets Manager, Bedrock policy, rotation Lambda, API Gateway Lambdas) is always on because it costs pennies.

Flip `enable_compute = true` for a live demo; flip it back after. The on-chain registry state persists; the node identities are KMS key ARNs which don't go away when compute is turned off.

## References

- Secrets layout, env vars, and rotation cadence: [`docs/SECRETS.md`](SECRETS.md).
- Observability dashboards and alarm thresholds: [`docs/OBSERVABILITY.md`](OBSERVABILITY.md).
- Terraform bootstrap + state backend: [`infrastructure/README.md`](../infrastructure/README.md).
- Python KMS signer: [`skill/chain/kms_signer.py`](../skill/chain/kms_signer.py). Tests in [`skill/tests/test_kms_signer.py`](../skill/tests/test_kms_signer.py).
