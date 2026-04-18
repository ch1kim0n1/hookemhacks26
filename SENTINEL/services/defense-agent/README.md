# `defense-agent`

Policy-bounded defense agent. Converts a confirmed threat into a signed `PolicyRegistry.verifyAndExecute(...)` transaction — and nothing else.

## Role in the pipeline

```
sentinel.detection.confirmed  ──►  defense-agent  ──►  (tx on-chain)
                                       │
                                       ├──►  sentinel.defense.submitted
                                       └──►  sentinel.defense.mined
```

## What it does

1. Consumes [ThreatConfirmedEvent@2](../../schemas/ThreatConfirmedEvent_v2.json) (also accepts @1 for back-compat).
2. Looks up the protocol adapter for `victimProtocol`; builds the primitive action (e.g. `pause()` selector + calldata).
3. Requests a `PolicyCompliance` proof from `zk-prover` (`ZK_PROVER_URL`).
4. Signs a `verifyAndExecute(seal, imageId, journalDigest, action)` tx with `DEFENSE_AGENT_KEY` and broadcasts.
5. Emits [DefenseSubmittedEvent@1](../../schemas/DefenseSubmittedEvent.json) immediately.
6. Waits for receipt, emits [DefenseMinedEvent@1](../../schemas/DefenseMinedEvent.json).

**Policy-bounded**: if the ZK prover fails to produce a proof (no matching rule, confidence below floor, unauthorised selector), the agent never gets a seal — no tx is sent. This is the cryptographic backstop behind the Agent Constraint Failure demo.

## Env

| Var | Default | Purpose |
|---|---|---|
| `RPC_URL` | `http://localhost:8545` | Chain submission |
| `REDIS_URL` | `redis://localhost:6379` | Stream bus |
| `DEFENSE_AGENT_KEY` | (testnet) | Signs verifyAndExecute |
| `POLICY_PATH` | `./config/policy.json` | Canonicalised policy (hash must match on-chain) |
| `ADDRESSES_FILE` | `./config/addresses.local.json` | Resolves PolicyRegistry and targets |
| `ZK_PROVER_URL` | `http://localhost:9100` | `/prove/policy` endpoint |
| `HEALTH_PORT_DefenseAgent` | `9004` | `/healthz` |

## Run locally

```bash
cd services/defense-agent
poetry install
poetry run python -m defense_agent
```

## Test

```bash
poetry run pytest -v --cov=defense_agent --cov-fail-under=40
```

CI gate is 40%; RPC-pathway branches are covered by integration tests in [../../contracts/test/integration/FullDefenseLifecycle.t.sol](../../contracts/test/integration/FullDefenseLifecycle.t.sol).
