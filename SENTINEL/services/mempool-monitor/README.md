# `mempool-monitor`

Watches anvil's WebSocket pending-tx pool, pulls each raw tx, extracts features, and publishes `PendingTxEvent@1` on `sentinel.mempool.pending`.

## Role in the pipeline

```
anvil WS  ──►  mempool-monitor  ──►  sentinel.mempool.pending  ──►  detection-engine, preemptive-strike
```

## What it does

1. Subscribes to `eth_subscribe("newPendingTransactions")` on `WS_URL`.
2. Fetches full tx via `eth_getTransactionByHash`.
3. Extracts features via [features.ts](src/features.ts): selector, 4-byte function, call-graph depth, flash-loan origin heuristic, protected-protocol heuristic.
4. Publishes the event with schema [PendingTxEvent.json](../../schemas/PendingTxEvent.json).
5. Exposes `/healthz` on `HEALTH_PORT_MempoolMonitor` (default 9001).

## Env

| Var | Default | Purpose |
|---|---|---|
| `WS_URL` | `ws://localhost:8545` | Anvil WebSocket |
| `RPC_URL` | `http://localhost:8545` | HTTP fallback for `getTransactionByHash` |
| `REDIS_URL` | `redis://localhost:6379` | Stream destination |
| `ADDRESSES_FILE` | `./config/addresses.local.json` | Used to flag `involvesProtectedProtocol` |
| `HEALTH_PORT_MempoolMonitor` | `9001` | `/healthz` |

## Run locally

```bash
pnpm --filter @sentinel/mempool-monitor dev
```

Requires anvil + redis: `docker compose up -d anvil redis`.

## Test

```bash
pnpm --filter @sentinel/mempool-monitor test
```

Covers feature extraction, WS-config fallbacks, and payload shape.
