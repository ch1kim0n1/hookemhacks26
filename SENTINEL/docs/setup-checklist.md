# Setup checklist (exact versions)

Use these versions to match CI and local Docker images.

| Tool | Version | Notes |
|------|---------|--------|
| Node.js | **20.11.1+** (LTS) | Matches `engines` in root `package.json` |
| pnpm | **8.15.4+** | `corepack enable && corepack prepare pnpm@8.15.4 --activate` |
| Python | **3.11.x** | For `detection-engine` and `defense-agent` (Poetry) |
| Poetry | **1.7.1** | `pip install poetry==1.7.1` |
| Foundry (`forge`) | **nightly** | Same as `.github/workflows/ci.yml` |
| Rust | **1.75+** | For `zk/` workspace (`cargo test`, RISC Zero host) |
| Docker | **24+** | For `docker compose` stack |

## Verify

```bash
node -v
pnpm -v
python3 --version
poetry --version
forge --version
cargo --version
docker compose version
```

Copy `.env.example` to `.env` and adjust secrets before production.
