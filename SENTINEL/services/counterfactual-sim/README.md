# `counterfactual-sim`

Ephemeral anvil fork + shadow-timeline replay. Given a confirmed threat, it simulates what would have happened on-chain if defense had not fired, computes per-address balance deltas, and commits their SHA-256 Merkle root.

## Role in the pipeline

```
sentinel.detection.confirmed  ──►  counterfactual-sim  ──►  sentinel.counterfactual.ready
```

## What it does

1. Consumes [ThreatConfirmedEvent@2](../../schemas/ThreatConfirmedEvent_v2.json).
2. Allocates a port from `ANVIL_PORT_POOL_START..+N`, spawns `anvil --fork-url $RPC_URL --fork-block-number <N>` (see [fork.ts](src/fork.ts)).
3. Replays the attacker transaction path against the fork; records balances of tracked leaves (configured per-protocol in [../../config/protocol-profiles/](../../config/protocol-profiles/)).
4. Computes `deltaWei` per leaf + 2's-complement-BE sum, builds a SHA-256 Merkle tree over `sha256(0x00 || key || delta)` leaves.
5. Emits [CounterfactualReadyEvent@1](../../schemas/CounterfactualReadyEvent.json) with `counterfactualRoot`, `deltaWei`, and per-leaf details.
6. Tears down the fork, returns the port to the pool.

## Env

| Var | Default | Purpose |
|---|---|---|
| `RPC_URL` | `http://localhost:8545` | Base chain to fork |
| `REDIS_URL` | `redis://localhost:6379` | Stream bus |
| `ANVIL_PORT_POOL_START` | `28545` | First port for spawned forks |
| `COUNTERFACTUAL_WAIT_DEFENSE` | `1` | If set, waits for `sentinel.defense.mined` before sampling Timeline A |
| `HEALTH_PORT_CounterfactualSim` | `9002` | `/healthz` |

## Run locally

```bash
pnpm --filter @sentinel/counterfactual-sim dev
```

Needs a real anvil reachable at `RPC_URL` to fork from — do not point it at mainnet unless you know what your port pool is doing.

## Test

```bash
pnpm --filter @sentinel/counterfactual-sim test
```

Covers fork spawn/teardown, delta math (two's-complement), Merkle root reproducibility, protocol-adapter selection.
