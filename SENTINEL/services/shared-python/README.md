# `shared-python`

Common Redis-stream helpers consumed by the three Python services (`detection-engine`, `defense-agent`, `federation-coordinator`).

## What's inside

- [`sentinel_streams/`](sentinel_streams/) — stream client, message codecs, consumer-group helpers
- [`pytest.ini`](pytest.ini) — shared pytest config

## Used by

| Service | How |
|---|---|
| [detection-engine](../detection-engine/) | Consumes `sentinel.mempool.pending`, produces `sentinel.detection.operator.<id>` |
| [defense-agent](../defense-agent/) | Consumes `sentinel.detection.confirmed`, produces `sentinel.defense.*` |
| [federation-coordinator](../federation-coordinator/) | Consumes `sentinel.detection.operator.*`, produces `sentinel.detection.confirmed` |

## Why a separate package

Keeps stream-handling logic (pending-id tracking, consumer-group rebalancing, schema validation at the boundary) out of each service, and keeps its tests isolated. Matches the role of [../../packages/stream-client](../../packages/stream-client) on the TypeScript side.

## Import

Each service's `pyproject.toml` references this directory via a path dependency — no publishing required.
