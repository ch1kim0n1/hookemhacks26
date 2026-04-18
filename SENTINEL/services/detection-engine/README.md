# `detection-engine`

Per-operator ML inference on mempool events. One process per operator (alpha, beta, gamma) — federation-coordinator aggregates their verdicts downstream.

## Role in the pipeline

```
sentinel.mempool.pending  ──►  detection-engine (×N)  ──►  sentinel.detection.operator.<id>
```

## What it does

Each operator instance:

1. Consumes `PendingTxEvent@1`.
2. Runs **IsolationForest** for anomaly scoring + **PyTorch LSTM** for sequence scoring over a sliding per-address window.
3. Drives a 4-state confidence machine: `IDLE → FLASH_LOAN_OBSERVED → ORACLE_IMPACT_OBSERVED → CONFIRMED`.
4. Calls the on-chain oracle (`eth_call OraclePair.getReserves()`) for live TWAP deviation evidence.
5. Emits [OperatorVerdict@1](../../schemas/OperatorVerdict.json) to `sentinel.detection.operator.<operatorId>`.

Operator ID, model seed, and signing key all come from env; the resulting `modelHash` is reproducible and pinned in [ModelRegistry](../../contracts/src/ModelRegistry.sol).

## Env

| Var | Default | Purpose |
|---|---|---|
| `OPERATOR_ID` | `alpha` | Sets stream namespace |
| `OPERATOR_<ID>_PRIVATE_KEY` | (testnet) | Signs model-registry updates |
| `RPC_URL` | `http://localhost:8545` | Oracle `eth_call` |
| `REDIS_URL` | `redis://localhost:6379` | Stream bus |
| `HEALTH_PORT_Operator<Id>` | `9031–9033` | `/healthz` |

## Run locally

```bash
cd services/detection-engine
poetry install
OPERATOR_ID=alpha poetry run python -m detection_engine
```

Compose runs three instances side-by-side.

## Test

```bash
cd services/detection-engine
poetry run pytest -v --cov=detection_engine --cov-fail-under=55
```

CI gate is 55% coverage.

## Benchmarks

Replay suite of 8 historical DeFi exploits lives in [bench/](bench/); run with `poetry run python -m bench.run`. Results: **8/8 caught, p50 = 2.40 ms**.
