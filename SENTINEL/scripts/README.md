# `scripts/` — Operational Scripts

43 scripts covering bootstrap, demo orchestration, verification, testing, backup/restore, and production deploy. Most shell; a handful of `.mjs` verifiers.

## Bootstrap / dev

| Script | Purpose |
|---|---|
| [bootstrap.sh](bootstrap.sh) | First-time setup — installs tools, deps, copies env |
| [dev.sh](dev.sh) | Launches anvil + contracts deploy + compose services |
| [reset.sh](reset.sh) | Tear down and reset local state |
| [stop.sh](stop.sh) | Stops every running compose service |
| [migrate.sh](migrate.sh) | Runs Postgres migrations manually |

## Demo

| Script | Purpose |
|---|---|
| [replay-scenario.sh](replay-scenario.sh) | Trigger a scenario from [../config/demo-scenarios/](../config/demo-scenarios/); `--list` to see the menu |
| [inject-instruction.sh](inject-instruction.sh) | Scenario B — unknown-pattern instruction |
| [trigger-preemptive-demo.sh](trigger-preemptive-demo.sh) | Preemptive-strike demo wrapper |
| [seed-demo-state.sh](seed-demo-state.sh) | Pre-populate demo-specific state on anvil |
| [pre-warm-proofs.sh](pre-warm-proofs.sh) | Generate + cache all three circuit proofs ahead of a live demo |
| [record-demo.sh](record-demo.sh) | Capture a demo run for playback |
| [demo-preflight.sh](demo-preflight.sh) | Health check before recording |
| [demo-smoke-test.sh](demo-smoke-test.sh) | Quick end-to-end sanity run |

## Verify / validate

All invoked by `pnpm run verify` (which runs in CI).

| Script | Checks |
|---|---|
| [verify-timings-sync.mjs](verify-timings-sync.mjs) | `config/timings.json` matches `frontend/public/config/timings.json` |
| [verify-redis-streams.mjs](verify-redis-streams.mjs) | Every service's declared stream names cross-reference |
| [verify-demo-scripts.mjs](verify-demo-scripts.mjs) | Demo shell scripts reference endpoints that exist |
| [verify-addresses.mjs](verify-addresses.mjs) | Addresses file shape + optional on-chain `eth_getCode` probe |
| [validate-schemas.mjs](validate-schemas.mjs) | Event schemas + fixtures — see [../schemas/README.md](../schemas/README.md) |

## Test

| Script | Purpose |
|---|---|
| [run-python-tests.sh](run-python-tests.sh) | Runs pytest across the three Python services with coverage gates |
| [e2e-smoke.sh](e2e-smoke.sh), [test-e2e.sh](test-e2e.sh) | End-to-end smoke test |
| [test-scenario-a.sh](test-scenario-a.sh), [test-scenario-b.sh](test-scenario-b.sh) | Scenario-specific assertions (chain state + ledger entries) |
| [test-preemptive-strike.sh](test-preemptive-strike.sh) | Preemptive flow assertions |
| [test-learning-loop.sh](test-learning-loop.sh) | Learning-loop generation + policy-update assertion |
| [test-multi-protocol.sh](test-multi-protocol.sh) | Cross-protocol immunity propagation |
| [soak-10.sh](soak-10.sh) / [soak-100.sh](soak-100.sh) / [soak-health.sh](soak-health.sh) | Sustained-load probes |

## Auth / secrets

| Script | Purpose |
|---|---|
| [generate-jwt-keys.sh](generate-jwt-keys.sh) | Create RS256 key-pair for api-gateway |
| [rotate-jwt-keys.sh](rotate-jwt-keys.sh) | Rotate without downtime |
| [rotate-secrets.sh](rotate-secrets.sh) | Rotate app-level secrets |
| [generate-production-env.sh](generate-production-env.sh) | Template a prod `.env` from `.env.example` |

## Backup / restore

| Script | Purpose |
|---|---|
| [backup.sh](backup.sh) | Orchestrates redis + postgres backups |
| [backup-postgres.sh](backup-postgres.sh), [restore-postgres.sh](restore-postgres.sh) | Postgres dump + restore |
| [backup-redis.sh](backup-redis.sh), [restore-redis.sh](restore-redis.sh) | Redis RDB snapshot handling |
| [cleanup-retention.sh](cleanup-retention.sh) | Enforces retention window |

## Production

| Script | Purpose |
|---|---|
| [deploy-vps.sh](deploy-vps.sh) | Full VPS bring-up |
| [check-production.sh](check-production.sh) | Prod health sweep |

## ZK / policy

| Script | Purpose |
|---|---|
| [prove-policy.sh](prove-policy.sh) | Generate one PolicyCompliance proof from stdin |
| [compute-policy-hash.sh](compute-policy-hash.sh) | Canonicalise + hash a policy JSON for on-chain binding |

## Conventions

- Every script is executable, `set -euo pipefail`, documents its usage in the top comment.
- Scripts that call api-gateway honour `API_BASE` (default `http://localhost:8080`).
- Scripts that touch production must tolerate dry-run via `--check` or equivalent.
- Adding a `test-*` or `verify-*` script? Wire it into `pnpm run verify` or a CI job so drift is caught.
