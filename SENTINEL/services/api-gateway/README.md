# `api-gateway`

REST + WebSocket surface over the Redis bus. JWT auth, RBAC, audit log, rate limit, demo orchestration endpoints, admin anvil-snapshot route.

## Role in the pipeline

```
everything on Redis + Postgres + chain  ──►  api-gateway  ──►  HTTP + WS clients (frontend, curl, judge)
```

## Endpoint map

| Route | Role required | Purpose |
|---|---|---|
| `GET /api/v1/health` | public | Aggregates every service's `/healthz` |
| `GET /api/v1/addresses` | public | Returns deployed contract addresses |
| `GET /api/v1/events` | viewer | Paginated recent events from `RECENT_EVENTS` buffer |
| `GET /api/v1/policy/*` | viewer | Current policy, history, hash |
| `GET /api/v1/ledger/*` | viewer | `CounterfactualLedger` entries + Merkle proofs |
| `GET /api/v1/threats/*` | viewer | `ThreatRegistry` signature lookup |
| `GET /api/v1/chains` | viewer | Chain/protocol selector data |
| `POST /api/v1/demo/replay-scenario` | operator | Triggers flash-loan attack on anvil (Scenario A) |
| `POST /api/v1/demo/inject-instruction` | operator | Injects unknown pattern to test PolicyCompliance fail (Scenario B) |
| `POST /api/v1/demo/preemptive` | operator | Seeds signature + replays attacker tx for pre-mempool pause demo |
| `POST /api/v1/admin/snapshot` | admin | `evm_snapshot` for chain rollback |
| `WS /ws` | demo token accepted | Live firehose of every `sentinel.*` stream |

## Env

| Var | Default | Purpose |
|---|---|---|
| `PORT_ApiGateway` | `8080` | HTTP port |
| `WS_PORT_ApiGateway` | `8081` | WebSocket port |
| `RPC_URL`, `REDIS_URL`, `POSTGRES_URL` | — | Data planes |
| `ADDRESSES_FILE` | `./config/addresses.local.json` | Contract map |
| `ATTACKER_KEY` | (testnet) | Signs the demo attacker tx |
| `SENTINEL_JWT_SECRET` | — | HS256 bearer tokens |
| `SENTINEL_ADMIN_PASSWORD` | — | Built-in admin for `POST /auth/token` |
| `SENTINEL_DEMO_TOKEN` | — | Pre-issued token for the demo UI |

RS256 is also supported via `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH`.

## Run locally

```bash
pnpm --filter @sentinel/api-gateway dev
```

Runs Postgres migrations on startup and probes every address via `eth_getCode` — fails fast if [../../config/addresses.local.json](../../config/addresses.local.json) is stale.

## Test

```bash
pnpm --filter @sentinel/api-gateway test
```

220+ unit-tests cover auth flow, RBAC matrix, audit log classification, chain route handlers, policy/ledger/events/threats endpoints, and rate limiting.

## Adding a demo endpoint

When a [scenario in config/demo-scenarios/](../../config/demo-scenarios/) is marked `runnable: false`, its `requires` block names the endpoint that needs to land here. Keep `audit.ts` and `rbac.ts` in sync: every new `/demo/*` route must be classified (audit) and role-gated (RBAC) in the same PR.
