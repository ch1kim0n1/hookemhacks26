# Demo rehearsal checklist

Use this when running the full ClawGuard demo (issues #65 / playbook).

## Before going live

- [ ] API up: `uvicorn skill.api:app --reload` (or your process manager)
- [ ] Dashboard build: `cd dashboard && npm ci && npm run build`
- [ ] Env: `ANTHROPIC_API_KEY`, optional chain vars in `.env`
- [ ] Health: `GET /api/health` returns `status: ok`

## Timing targets (record actuals)

| Step | Target | Notes |
|------|--------|--------|
| Scenario A — text injection | &lt; 1s | Scanner tab |
| Scenario B — PDF | &lt; 2s | Depends on pdfplumber |
| Scenario C — chain path | varies | Needs `CLAWGUARD_REGISTRY_ADDRESS` + key |
| Defense propagation (stub) | &lt; 30s | Network layer is integration stub |

## Runs

Run the full demo sequence **at least 10 times** and note pass/fail and wall-clock time:

| Run # | Pass? | Total time (min) | Notes |
|-------|-------|------------------|-------|
| 1 | | | |
| 2 | | | |
| … | | | |

## Fallbacks

- [ ] Document what to say if chain RPC is down (local cache / offline mode)
- [ ] Backup screen recording path: _______________
