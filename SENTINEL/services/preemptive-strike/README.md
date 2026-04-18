# `preemptive-strike`

Fires `PauseController` on the victim protocol **before** a matched attacker tx is mined. Also seeds cross-federation immunity from confirmed detections.

## Role in the pipeline

```
sentinel.mempool.pending       ─┐
                                ├─►  preemptive-strike  ─►  PauseController (tx)
sentinel.detection.confirmed   ─┘                        ├─►  ThreatRegistry (signature publish)
                                                          └─►  sentinel.preemptive.*
```

## What it does

Two loops run side-by-side:

- **Mempool matcher** ([mempool-matcher.ts](src/mempool-matcher.ts)): indexes `(attackerAddress, selector)` tuples seeded by confirmed detections. When a `PendingTxEvent` matches, it broadcasts `PauseController.pause(target)` immediately — often before anvil mines the attacker's tx.
- **Registry federation** ([registry-federation.ts](src/registry-federation.ts)): on a local confirmed detection, publishes the attack signature to `ThreatRegistry` on-chain and fans out to peer federations so they see the signature too.

Emits [PreemptiveStrikeEvent@1 or PreemptiveAlertEvent@1](../../schemas/PreemptiveStrikeEvent.json) based on outcome (`action: "pause"` vs `action: "alert"`).

## Env

| Var | Default | Purpose |
|---|---|---|
| `RPC_URL` | `http://localhost:8545` | Pause tx submission |
| `REDIS_URL` | `redis://localhost:6379` | Stream bus |
| `STRIKE_OPERATOR_KEY` | (testnet) | Signs PauseController + ThreatRegistry writes |
| `ADDRESSES_FILE` | `./config/addresses.local.json` | Resolves PauseController and targets |
| `HEALTH_PORT_PreemptiveStrike` | `9006` | `/healthz` |

## Run locally

```bash
pnpm --filter @sentinel/preemptive-strike dev
```

The `POST /api/v1/demo/preemptive` endpoint on api-gateway drives this service end-to-end — seeds a confirmed detection, then replays the attacker tx so both code paths fire. Covered by the [preemptive-strike](../../config/demo-scenarios/preemptive-strike.json) scenario.

## Test

```bash
pnpm --filter @sentinel/preemptive-strike test
```

Unit-tests for the matcher, registry publisher, and signature-to-stream fan-out.
