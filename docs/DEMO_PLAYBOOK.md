# ClawGuard demo playbook

## Scenario A — Victim lending pool

1. Deploy `VictimLendingPool` + `MockOraclePair` (see `contracts/DEPLOY.md`).
2. Run `make api` and `make dashboard`; open the **Try It** tab and run an injection preset.
3. Observe **Blocked feed** and on-chain publish when `CLAWGUARD_*` env is set.

## Scenario B — PDF / email

1. Use **file_read** / **email_read** hooks (`skill/SKILL.md`) with a crafted attachment path in the agent.
2. Confirm extraction + block in API logs (`clawguard.db`).

## Scenario C — Network intel

1. Start API with Base Sepolia registry address.
2. Publish one attack from the dashboard scan; second agent instance should **cache** the hash (`poll_recent`).

## Load / perf

- `python scripts/load_bench.py --requests 100 --url http://127.0.0.1:8000/api/scan`

## ZK (optional)

- Tests use `MockGroth16Verifier`. Replace with real verifier bytecode before production.
