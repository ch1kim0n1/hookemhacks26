# SENTINEL → ClawGuard pivot baseline

Recorded before the unified-tree refactor (`pre-sentinel-pivot` tag recommended).

## How to capture test counts (run locally)

```bash
# ClawGuard
cd clawguard && uv run pytest -q 2>&1 | tail -5

# SENTINEL (before removal)
cd SENTINEL && pnpm test 2>&1 | tail -20
cd SENTINEL && pnpm test:python 2>&1 | tail -20
cd SENTINEL/zk && cargo test -q 2>&1 | tail -10
```

## Demo verdict baseline

Run `make demo` with `.env` configured; note BLOCK/PASS per staged attack fixture in `demo/attacks/`.

## Notes

- Consolidated Python deps live in root `pyproject.toml` optional groups: `sentinel`, `local`.
