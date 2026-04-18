# `services/` — Off-chain Microservices

Nine services that together form the SENTINEL off-chain control plane. Six TypeScript (Node 20), three Python (3.11 + Poetry). All communicate over Redis streams using the schemas in [../schemas/](../schemas/).

## Service map

| Service | Lang | Role | Stream in | Stream out |
|---|---|---|---|---|
| [mempool-monitor](mempool-monitor/) | TS | Watches anvil WS pending pool, extracts features | — | `sentinel.mempool.pending` |
| [detection-engine](detection-engine/) | Py | Per-operator ML inference (IsolationForest + LSTM) | `sentinel.mempool.pending` | `sentinel.detection.operator.<id>` |
| [federation-coordinator](federation-coordinator/) | Py | K-of-N quorum aggregator | `sentinel.detection.operator.*` | `sentinel.detection.confirmed` |
| [counterfactual-sim](counterfactual-sim/) | TS | Forks anvil, replays attack, commits delta root | `sentinel.detection.confirmed` | `sentinel.counterfactual.ready` |
| [zk-prover](zk-prover/) | TS | RISC Zero proof generation + L1/L2 cache | `sentinel.counterfactual.ready` | `sentinel.ledger.recorded` |
| [defense-agent](defense-agent/) | Py | Signs + broadcasts `PolicyRegistry.verifyAndExecute` | `sentinel.detection.confirmed` | `sentinel.defense.submitted`, `sentinel.defense.mined` |
| [preemptive-strike](preemptive-strike/) | TS | Matches attacker-signature in the mempool and fires `PauseController` before inclusion | `sentinel.mempool.pending`, `sentinel.detection.confirmed` | `sentinel.preemptive.*` |
| [learning-loop](learning-loop/) | TS | Red/Blue adversarial training, proposes policy updates | — (self-driven) | `sentinel.training.*` |
| [api-gateway](api-gateway/) | TS | REST + WebSocket surface, JWT/RBAC, demo endpoints | all | HTTP + WS |
| [shared-python](shared-python/) | Py | Redis stream helpers consumed by the 3 Python services | — | library |

See [../packages/](../packages/) for the equivalent TypeScript helpers.

## Running locally

```bash
docker compose up -d           # everything
docker compose up -d mempool-monitor detection-engine-alpha federation-coordinator
```

Or run a single service directly after `docker compose up -d anvil postgres redis`:

```bash
pnpm --filter @sentinel/api-gateway dev
cd services/detection-engine && poetry run python -m detection_engine
```

Env is seeded from [../.env.example](../.env.example); each service lists the vars it reads in its own README.

## Testing

```bash
# TS services (vitest)
pnpm --filter "./services/*" test

# Python services (pytest + coverage gates: 55 / 40 / 90 %)
pnpm run test:python
```

Both lanes run on every PR — see [../.github/workflows/ci.yml](../.github/workflows/ci.yml).

## Conventions

- **One schema per producer.** If you add a new event type, put the JSON Schema in [../schemas/](../schemas/), add a fixture pair, and update [CHANGELOG.md](../schemas/CHANGELOG.md).
- **Validate at the boundary.** Every consumer validates incoming messages before running any business logic.
- **Health ports.** Each service exposes `/healthz` on its `HEALTH_PORT_*` env var; api-gateway aggregates these into `/api/v1/health`.
- **No cross-service imports.** Shared code goes in [../packages/](../packages/) (TS) or [shared-python/](shared-python/) (Py).
