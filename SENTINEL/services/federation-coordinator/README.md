# `federation-coordinator`

K-of-N verdict aggregator across the three detection operators. Turns N independent `OperatorVerdict@1` messages into one `ThreatConfirmedEvent@2`.

## Role in the pipeline

```
sentinel.detection.operator.*  ──►  federation-coordinator  ──►  sentinel.detection.confirmed
```

## What it does

1. Subscribes to the `sentinel.detection.operator.*` pattern via Redis keyspace.
2. Buckets verdicts per `triggeringTxHash` inside a time window.
3. Counts verdicts with `level == "confirmed"`. If ≥ K, emits [ThreatConfirmedEvent@2](../../schemas/ThreatConfirmedEvent_v2.json) containing every operator attestation in a `federation` block.
4. Verdicts under K time out and drop; an alert fires if an operator is silent across many windows.

The v2 schema is a superset of v1 — consumers that haven't migrated still see the familiar fields.

## Env

| Var | Default | Purpose |
|---|---|---|
| `FEDERATION_OPERATORS` | `alpha,beta,gamma` | Members of the federation |
| `FEDERATION_THRESHOLD_K` | `2` | Quorum |
| `FEDERATION_WINDOW_SECONDS` | `60` | Time budget to collect verdicts |
| `REDIS_URL` | `redis://localhost:6379` | Stream bus |
| `HEALTH_PORT_FederationCoordinator` | `9010` | `/healthz` |

## Run locally

```bash
cd services/federation-coordinator
poetry install
poetry run python -m federation_coordinator
```

## Test

```bash
poetry run pytest -v --cov=federation_coordinator --cov-fail-under=90
```

CI gate is 90% — the highest of any Python service. The aggregator logic is small and heavily exercised.

## Edge cases covered

- Duplicate verdicts from the same operator id (deduplicated, last write wins within a window)
- Silent operator for one window (flagged, does not block quorum)
- Mixed `level` values (only `confirmed` counts toward K)
- Window rollover while a tx is still collecting verdicts
