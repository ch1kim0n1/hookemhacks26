# `zk-prover`

TypeScript wrapper around the RISC Zero host CLIs in [../../zk/host/](../../zk/host/). Exposes `/prove/policy`, `/prove/counterfactual`, `/prove/learning` over HTTP and publishes the resulting ledger record.

## Role in the pipeline

```
sentinel.counterfactual.ready  ──►  zk-prover  ──►  sentinel.ledger.recorded
                HTTP clients ──► /prove/*
```

## What it does

1. Accepts JSON inputs on `/prove/<circuit>`.
2. Checks the L1 (in-memory LRU) and L2 (Postgres) caches keyed by `sha256(input_json)`.
3. On miss, spawns the corresponding Rust binary (e.g. `zk/target/release/prove_policy`), pipes the input over stdin, parses the JSON envelope.
4. Persists to L2, returns `{ proof, publicInputs, imageId, journal, elapsedMs }`.
5. For counterfactual flows, [ledger_publisher.ts](src/ledger_publisher.ts) calls `CounterfactualLedger.record(...)` with the seal and publishes [LedgerRecordedEvent@1](../../schemas/LedgerRecordedEvent.json).

See [../../zk/README.md](../../zk/README.md) for the underlying proving system and [../../zk/BENCHMARKS.md](../../zk/BENCHMARKS.md) for expected wall-clock.

## Env

| Var | Default | Purpose |
|---|---|---|
| `PORT_ZkProver` | `9100` | HTTP listen port |
| `RISC0_DEV_MODE` | `1` | `1` = mock seal, `0` = real Groth16 |
| `PROVE_BACKEND` | `local` | `local` spawns the Rust bin; `bonsai` uses remote API |
| `BONSAI_API_URL` / `BONSAI_API_KEY` | — | Needed when `PROVE_BACKEND=bonsai` |
| `PROVE_TIMEOUT_POLICY_MS` | `35000` | Fallback to cache on timeout |
| `PROVE_TIMEOUT_COUNTERFACTUAL_MS` | `15000` | same |
| `PROVE_TIMEOUT_LEARNING_MS` | `70000` | same |
| `PROVER_KEY` | (testnet) | Signs `CounterfactualLedger.record(...)` |
| `POSTGRES_URL`, `REDIS_URL` | — | L2 cache + stream publish |

## Run locally

```bash
pnpm --filter @sentinel/zk-prover dev
# and, for real proofs:
cd zk && cargo build --release --bins
```

Pre-warm the cache before a live demo so every circuit has a hit:

```bash
bash scripts/pre-warm-proofs.sh
```

## Test

```bash
pnpm --filter @sentinel/zk-prover test
```

Covers cache semantics, fallback-on-timeout, ledger publisher formatting, and the CLI envelope parser.
