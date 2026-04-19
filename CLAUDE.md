# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ClawGuard is security middleware for OpenClaw agents. It intercepts inbound content (email, web, files, images, PDFs, audio), runs a three-layer prompt-injection detection pipeline, and publishes threat intel on-chain to Base Sepolia (chain id 84532). The repo is a hackathon demo — parts are production-grade, parts are explicit scaffolds. The canonical state of each subsystem is in the **Project Honesty** table in `README.md` — consult it before assuming any module is fully wired (notably: `learning/` red agent is a stub, `zk/prover_host.py` returns mock Groth16, on-chain tx anomaly detection under `detector/on_chain/` is exploratory).

## Common commands

All Python entry points run under `uv`. Dashboard uses npm.

```bash
make setup            # uv venv + uv pip install -e ".[pdf-gen,dev]" + dashboard npm install
make fixtures         # regenerate demo attack fixtures under demo/attacks/
make migrate          # apply Alembic migrations (also runs automatically on API startup)
make api              # uvicorn skill.api:app --reload on :8000
make dashboard        # Vite dev server on :5175
make demo             # runs demo/trading_agent/agent.py against the API
make demo-full        # api + dashboard + demo agent in one shot
make quality          # CI parity: ruff + bandit + pytest
make redeploy         # fresh ThreatRegistry deploy + wipes clawguard.db + re-migrates (demo reset)
make contracts        # forge script Deploy.s.sol to Base Sepolia
make test-headers     # curl /api/health and assert CSP header is present
```

### Tests

Pytest config lives in `pyproject.toml` (`[tool.pytest.ini_options]`). `testpaths` covers `skill/tests`, `learning/tests`, `network/tests`, `blockchain/tests`, `zk/tests`, and the top-level `tests/{contracts,corpus,integration,performance}`. `asyncio_mode = "auto"`.

```bash
uv run pytest -q                                           # full suite
uv run pytest skill/tests/test_detection_pipeline.py -v    # one file
uv run pytest -k test_admin_auth -v                        # by name
uv run pytest skill/tests/test_migrations.py -v            # after changing migrations
cd contracts && forge test -vvv                            # Solidity tests (separate CI job)
```

### Lint / security

```bash
uv run ruff check skill/ api/ detector/ extractor/ blockchain/ learning/ zk/ network/
uv run bandit -r skill/ detector/ extractor/ blockchain/ learning/ zk/ api/ -ll -q
```

The `contracts/`, `dashboard/`, `public/`, and `.worktrees/` trees are excluded from ruff, bandit, and mypy via `pyproject.toml` — don't add them back. Ruff's `per-file-ignores` deliberately relax rules for `**/tests/**`, migration scripts, `detector/bench/**` (research code), and `zk/prover_host.py` (import-order for mock mode).

### Migrations

Alembic config is at `alembic.ini`; versions live in `skill/migrations/versions/`. Use `uv run alembic -c alembic.ini ...` (not bare `alembic`). `make migrate` shells into `skill.db.run_migrations`. The API's `/api/ready` returns **503** until Alembic is at head — prefer `/api/ready` for orchestrator health checks and `/api/health` for cheap liveness.

## Architecture

The short version (see `README.md` for the diagram):

```
Inbound content → extractor/ → SHA-256 hash → ChainClient cache hit? → block
                                     ↓ miss
                               skill/detectors/pipeline.detect
                                     ↓
                        rules (severity ≥ 0.9 → block, short-circuit)
                                     ↓
                        classifier (deberta-v3 prompt-injection-v2)
                                     ↓
                        LLM judge (Claude Haiku) — fails closed to sanitize
                                     ↓
                          verdict → log_detection → audit_log
                                     ↓ if block
                          chain.publish_attack + async ZK attestation
```

### Package boundaries

- **`skill/`** — the OpenClaw skill and the **canonical** FastAPI app.
  - `handler.py` — `intercept()` is the OpenClaw pre-tool hook. `scan_only()` is the dashboard-facing non-raising variant. Both go through the same extractor → cache → pipeline → enrich → audit flow; keep them in sync when changing behavior.
  - `api.py` — FastAPI app with CSP, admin auth on `/api/audit`, bearer auth on `/metrics`, WS auth on `/ws/updates`, rate limiting, Alembic gate on `/api/ready`.
  - `detectors/` — `rules.py` (30 regex rules), `pipeline.py` (three-layer short-circuit), `judge.py` (Claude Haiku, fail-closed to `sanitize`).
  - `chain/client.py` — the **canonical** `ChainClient`. `skill.handler.get_chain_client()` is a module-level singleton that starts a 60s poller. Tests patch this singleton.
  - `config/settings.py` (non-secret knobs) + `config/secrets.py` (`SecretsManager`, env-first with pluggable backends).
  - `migrations/versions/` — Alembic 001 init, 002 audit_log, 003 indexes. Number new files continuing the sequence.
- **`api/index.py`** — Vercel serverless entrypoint. Thin re-export of `skill.api:app` (per README, "full parity"). Do not fork logic here.
- **`extractor/`** + **`skill/extractors/`** — multimodal text extraction. `skill/extractors/` are thin wrappers that delegate to `extractor/`. Every heavy backend (Whisper, Tesseract, transformers, web3) is optional — preserve graceful ImportError fallbacks.
- **`detector/`** — `classifier.py` wraps the ML model; `detector/on_chain/` is exploratory tx anomaly code (IsolationForest + state machine), benchmarks in `detector/bench/`.
- **`blockchain/`** — async RPC client, mempool monitor, pre-emptive strike, `defense_agent`. Separate from `skill/chain/` which only handles the threat registry.
- **`learning/`** — red/blue adversarial loop scaffold. `publisher.py` writes to `DefenseProtocol` on-chain. Read `learning/README.md` for what is real vs placeholder before extending.
- **`zk/`** — RISC Zero host + guests. `prover_host.py` currently returns mock Groth16 JSON gated by `CLAWGUARD_ZK_MODE` (`real` | `mock` | `auto`). Real integration steps in `zk/INTEGRATION.md`.
- **`network/`** — `poller.py` + `applier.py` for peer fan-out of defense updates (`CLAWGUARD_PEER_URLS`).
- **`contracts/`** — Foundry project. `ClawGuardRegistry`, `DefenseProtocol`, `ConsensusVoting`, `PauseController`, `VictimLendingPool`. `make redeploy` rewrites `.env` with the new address and wipes the local cache.
- **`dashboard/`** — React 19 + Vite 8 + Tailwind 4 SPA (`:5175`). Talks to the FastAPI server on `:8000`. `frontend` at repo root is a symlink to `dashboard`.

### Cross-cutting conventions

- **Verdict shape**: `{verdict, confidence, reasons, content_hash, layer_reached, sanitized_content, details, ...}`. Always call `skill.reason_codes.enrich_verdict(v)` before returning or auditing so `reason_codes` / `reason_family` are populated.
- **Content hashing**: always via `skill.threat_identity.content_sha256_hex` on the extracted text (not the raw bytes). This is the key used against the chain cache.
- **Fail-closed judge**: `skill/detectors/judge.py` must return `sanitize` on transient errors — never `pass`. Do not "soften" this to reduce false positives.
- **Audit vs detection log**: every hook invocation writes to `audit_log` via `_audit_tool_intercept`; non-pass verdicts additionally write an `attack_blocked` / `attack_sanitized` row via `_audit_non_pass`, and detections go to `detection_log` via `db.log_detection`. Keep all three in sync when adding new code paths in `handler.py`.
- **ZK attestation is fire-and-forget**: `_attest_scan_async` in `handler.py` runs in a daemon thread. It must not block the block/sanitize return to the agent.
- **Admin endpoints** (`/api/audit`, `/metrics`, `/ws/updates`) require tokens in production. `REQUIRE_ADMIN_TOKEN=false` / `REQUIRE_METRICS_TOKEN=false` are local-dev only; never commit these flipped in prod configs.
- **Rate limiting** is per-process and keys by `X-Forwarded-For` when present. For multi-replica deploys, rely on edge rate limiting or wire the Redis store already in `docker-compose.yml`.

## Environment

Python `>=3.11` (CI uses 3.12). Node 20 for the dashboard. `uv` is the expected Python runner throughout Makefile and docs — prefer it over `python -m pip`. `.python-version` pins the local interpreter. Secrets flow through `skill.config.secrets.get_secret`; the authoritative list is `docs/SECRETS.md`, with the most load-bearing variables called out in `README.md`.

## CI

`.github/workflows/ci.yml` runs three independent jobs: `forge test` (contracts), `pytest + ruff + bandit` (python, 3.12), and `npm run build` (dashboard). `make quality` reproduces the python job locally. Match that set before pushing.
