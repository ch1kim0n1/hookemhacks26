# Backup Laptop Setup Guide

Step-by-step reproduction from a clean clone. Budget ~25 minutes on a fast machine.

## Prerequisites

Install all tools from [setup-checklist.md](./setup-checklist.md) before continuing.

## Steps

### 1. Clone and enter the repo (~1 min)

```bash
git clone https://github.com/ch1kim0n1/hookemhacks26.git sentinel
cd sentinel
```

### 2. Copy environment config (~1 min)

Either copy `.env` from the primary laptop over USB/AirDrop, or generate from the template:

```bash
cp .env.example .env
# Edit .env — set BONSAI_API_KEY, DATABASE_URL, JWT_SECRET, etc.
```

### 3. Run Phase 1 bootstrap (~10 min)

```bash
./scripts/bootstrap.sh
```

This installs Foundry libs, builds ZK guests, compiles contracts, installs pnpm deps,
boots Anvil, deploys all 16 contracts, and writes `config/addresses.local.json`.

### 4. Start Docker services (~3 min)

```bash
docker compose up -d
```

Wait for all containers to report healthy:

```bash
docker compose ps
```

### 5. Seed demo state (~2 min)

```bash
./scripts/reset.sh
./scripts/seed-demo-state.sh
./scripts/pre-warm-proofs.sh
```

### 6. Install Python service deps (~5 min)

```bash
cd services/detection-engine && poetry install && cd ../..
cd services/defense-agent && poetry install && cd ../..
cd services/federation-coordinator && poetry install && cd ../..
```

### 7. Verify with a single smoke run (~3 min)

```bash
RUNS=1 ./scripts/demo-smoke-test.sh
```

All green → backup laptop is primed and ready.

## Quick re-prime between attempts

If you already ran the demo once and need to reset state fast:

```bash
./scripts/reset.sh && ./scripts/seed-demo-state.sh && ./scripts/pre-warm-proofs.sh
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `addresses.local.json` stale / missing | Re-run `./scripts/bootstrap.sh` |
| Redis connection refused | `docker compose up -d redis` |
| Anvil not running | `anvil --host 127.0.0.1 --port 8545 --block-time 2 &` |
| ZK prover timeout | Ensure `RISC0_DEV_MODE=1` in `.env` for local mode |
| Poetry venv mismatch | `cd services/detection-engine && poetry env remove --all && poetry install` |
