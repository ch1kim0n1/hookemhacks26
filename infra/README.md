# `infra/` — Deployment & Observability

Configuration for the local and production stacks. The actual orchestration lives in [../docker-compose.yml](../docker-compose.yml); this directory holds the configs that compose mounts into containers.

## Layout

| Path | Purpose |
|---|---|
| [docker/](docker/) | Extra Dockerfiles and compose overrides (prod profile, Caddy reverse proxy) |
| [prometheus/](prometheus/) | Prometheus scrape config — all services expose `/metrics` |
| [grafana/](grafana/) | Grafana provisioning (datasources, dashboards, folders) |

## Profiles

- **default** — nine app services + anvil + redis + postgres. Intended for dev.
- **production** — adds Redis Sentinel HA, Caddy TLS termination, rate limiter.

Launch a profile:

```bash
docker compose up -d                         # default
docker compose --profile production up -d    # production
```

## Environment

Production secrets are templated from [../.env.example](../.env.example) via [../scripts/generate-production-env.sh](../scripts/generate-production-env.sh); never commit the result.

## Observability

All TypeScript services emit Pino JSON logs; Python services emit `structlog` JSON. Prometheus scrapes `/metrics`; Grafana dashboards under [grafana/](grafana/) visualise:

- mempool ingestion rate
- detection-engine latency p50/p95 per operator
- federation quorum hit rate
- proof cache hit ratio (L1 / L2)
- defense-agent submit → mine latency
- learning-loop win rate per generation

## Pre-prod checklist

See [../docs/runbooks/restore.md](../docs/runbooks/restore.md) for incident recovery, and [../scripts/check-production.sh](../scripts/check-production.sh) for the automated sweep.
