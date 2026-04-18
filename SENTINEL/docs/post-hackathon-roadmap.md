# Post-hackathon engineering roadmap

This file replaces the long tail of parallel GitHub issues with a single source of truth. Historical issue numbers are listed so nothing is lost when those issues are closed.

**Legend:** Done = implemented on `main`. Partial = scaffold or MVP exists. Future = explicit follow-up.

| # | Topic | Status | Notes |
|---|--------|--------|--------|
| 2 | Groth16 verifiers from circuits | Done | `zk/host/src/bin/dump_image_ids.rs` + deploy script reads `config/zk-image-ids.json`; each sentinel wrapper pins its image ID at construction. |
| 3 | CounterfactualCorrectness ZK guest | Done | `zk/guest/counterfactual-correctness` with 5-slot journal; Hybrid Approach A (forkBlockHash grounding) active. Full revm-in-zkVM remains Future. |
| 12 | Fuzz / invariant tests (contracts) | Partial | Foundry fuzz config in `foundry.toml`; expand per-contract |
| 13 | Gas snapshot benchmarks | Partial | CI runs `forge snapshot` (non-blocking); tighten thresholds later |
| 14 | ZK host-side circuit tests | Done | `zk/host/tests/` covers all three guests; CI runs fast dev-mode tests on every push, real Groth16 under `full-zk` label. |
| 15 | Proof cache in Postgres | Done | Migration 005 + two-tier cache in `services/zk-prover/src/proof-cache.ts` (L1 LRU + L2 Postgres). |
| 20 | Missing UI (ProofViewer, NavBar, …) | Partial | Core demo routes exist; polish components as needed |
| 21 | DemoOrchestrator drives backend | Done | `DemoControls` + gateway `/demo/replay-scenario` + `/demo/inject-instruction` + `/demo/preemptive`. |
| 22 | counterfactual-sim wait for defense tx | Done | `COUNTERFACTUAL_WAIT_DEFENSE` env toggle (default on). |
| 29 | Record 90s dry-run video | Ops | Manual asset; not a code deliverable |
| 30 | Backup laptop reproducibility | Ops | Use `docs/setup-checklist.md` + `pnpm bootstrap` |
| 31 | Graceful proof timeout degradation | Partial | `config/timings.json` timeouts; zk-prover fast-fail paths |
| 32 | Deploy LearningVerifier + wire registry | Done | `DeployLocal.s.sol` deploys all three verifiers; learning-loop calls `/prove/learning` and submits via `ChainUpdater`. |
| 39 | LearningLoopCorrectness guest | Done | `zk/guest/learning-correctness` active; proves aggregate win-rate floor. |
| 41 | Bonsai production path | Partial | `BONSAI_API_KEY` + `PROVE_BACKEND` env wiring; tuning + retries not hardened. |
| 55 | DeployLocal addresses match config | Done | `DeployLocal` writes `config/addresses.local.json`; `pnpm run verify:addresses` enforces freshness; api-gateway probes bytecode at startup. |
| 56 | E2E Scenario B | Partial | `scripts/test-scenario-b.sh`, gateway `/demo/inject-instruction` |
| 57 | E2E Scenario A timing <10s | Partial | `config/timings.json` + `scripts/demo-smoke-test.sh` |
| 58 | DualTimeline $2.4M tick animation | Future | UX polish; scrub bar landed |
| 60 | viem + ABI for TrustInterface | Done | `useChainQuery` + gateway `/api/v1/addresses` |
| 64 | Zustand vs doc 07 | Done | `frontend/src/store.ts` covers trust, ledger, graph, counterfactual, demo, training (with NN metrics), immunity, chains. |
| 65 | mempool-monitor WS reconnect tests | Future | Add vitest with mocked transport |
| 66 | counterfactual-sim fork/delta tests | Done | `services/counterfactual-sim/src/sim.test.ts` + new `fork.test.ts` (port-pool concurrency). |
| 67 | detection-engine eth_call tests | Future | Expand pytest in `services/detection-engine` |
| 68 | Redis integration chain tests | Partial | `api-gateway` route tests + `stream-client` consumer tests |
| 70 | mempool-monitor Redis publish tests | Future | Mock `ioredis` publish assertions |
| 71 | detection-engine confidence product tests | Future | Pytest for scorer math |
| 73 | counterfactual-sim deterministic replay | Future | Golden-vector regression test |
| 76 | Redis channels vs doc 03 | Done | `pnpm run verify:streams` enforces stream name catalog. |
| 77 | Service integration via Redis | Partial | Covered by compose + stream-client tests |
| 79 | Python pytest in CI | Done | `.github/workflows/ci.yml` runs all three Python services |
| 86 | All Dockerfiles build | Ops/CI | Run `docker compose build` locally before demo day |
| 93 | seed-demo-state.sh correctness | Partial | Script exists `scripts/seed-demo-state.sh`; verify after contract changes |
| 94 | pre-warm-proofs.sh both scenarios | Partial | `scripts/pre-warm-proofs.sh`; extend for scenario B if split |
| 95 | timings.json vs demo budget | Done | `pnpm run verify:timings` enforces consistency. |
| 97 | ImmunityMap 12-protocol data | Done | `config/immunity-propagation.json` wired; preemptive-strike now propagates signatures via `sentinel.detection.confirmed` hook. |
| 99 | FlashLoanAttacker integration | Done | `test/integration/FlashLoanDefense.t.sol` |
| 100 | SentinelGuard + VictimLendingPool | Done | Same integration suite + `SentinelGuard` wired in deploy script |
| 101 | 10 consecutive demo runs | Ops | Use `scripts/soak-100.sh` against health + manual demo passes |
| 102 | TrustInterface choreography vs doc 12 | Partial | `DemoOrchestrator` + timings; pixel-perfect match optional |
| 103 | Five tiles 85–90s | Partial | `DemoMode` grid; timing device-dependent |
| 106 | Performance budgets | Future | Lighthouse / manual projector rehearsal |
| 108 | Cached counterfactual proof scenario A | Partial | zk-prover cache + `RISC0_DEV_MODE`; full proof path optional |

## Capabilities shipped beyond the original plan

| Capability | Status | Notes |
|------------|--------|--------|
| Detection-engine ML (IsolationForest + LSTM) | Done | `anomaly_scorer.py` + `sequence_detector.py`; replaced heuristic-only scoring. |
| Federation coordinator (K-of-N quorum) | Done | `services/federation-coordinator` aggregates 3 independent detection operators before any defense fires. |
| Preemptive strike engine | Done | `services/preemptive-strike` wired to mempool + training + **detection.confirmed** streams; publishes to `ThreatRegistry`, fires `PauseController`; cross-protocol immunity propagation; new `/api/v1/demo/preemptive` + `scripts/trigger-preemptive-demo.sh`. |
| Real neural network in learning loop | Done | Hand-rolled 5→8→4→1 MLP with backprop + SGD+momentum in `services/learning-loop/src/nn.ts`. Trained each generation on physics-grounded labels from `neural-detector.ts` constant-product slippage model. Per-epoch loss/accuracy + per-generation precision/recall/FPR streamed to UI. |
| Bayesian optimizer for Red agent | Done | Gaussian Process + UCB acquisition; 3–5× faster than random mutation. |
| Postgres migration recovery | Done | Checksum-tracked migrations, drift detection, `SENTINEL_DB_ALLOW_RESET=1` escape hatch, idempotent-error auto-recovery. |
| Anvil port-pool allocator | Done | `services/counterfactual-sim/src/fork.ts` reserves ports with in-process Set + physical bind probe; eliminates concurrent-fork races. |
| `addresses.local.json` staleness guard | Done | `scripts/verify-addresses.mjs` (file + RPC probe) + runtime `probeAddressesOnChain()` in api-gateway. |
| Redis Sentinel HA config | Done | Hardened `config/redis/sentinel.conf` for 1 master + 2 replicas + 3 sentinels (production profile). |

## How to use this file

1. Pick a **Future** row and open a **new, small** GitHub issue with acceptance criteria.
2. For **Ops** rows, attach artifacts (video link, machine spec) in your team wiki — not the code repo.
3. When you ship something new, add it to the **Capabilities shipped beyond the original plan** table.

---

## Deferred from 2026-04-18 critique fixes

These were valid critiques but deliberately out of scope for the
hackathon window. Preserved here so they aren't lost.

| Item | Lift | Why it was cut | When to reopen |
|---|---|---|---|
| **Sepolia deployment.** Deploy the full contract suite to Sepolia, point `mempool-monitor` at a public testnet endpoint, show a real pending tx paused on Etherscan during the pitch. | ~2 engineer-days + funded deployer account + gas budget. | Cuts the "it's all on Anvil" objection, but requires ops work that doesn't fit the hackathon window. | First serious demo to an external sponsor. |
| **Real mempool archive ingest.** Replay an actual raw Harvest Finance attack tx (from Blocknative / EigenPhi public datasets) through `detection-engine`. | 1 engineer-day + dataset licensing check. | Would make the 8/8 historical-replay number airtight against "but you reconstructed the txs", but the reconstruction is already documented in `bench/attack_corpus.py`. | Before any customer pilot. |
| **Full EVM re-execution in `CounterfactualCorrectness`.** Run revm inside the zkVM so the counterfactual is cryptographically sound, not just tamper-evident. | 2+ weeks, non-trivial proving-budget work. Currently documented as Hybrid Approach A in `absolute-docs/04`. | The proof proves structural consistency and binding, not simulator correctness. Judges who ask get the honest answer (see `docs/judge-qa.md` → Known limitations). | When proving cost drops to a reasonable budget, or Bonsai adds an EVM precompile. |
| **Cross-host federation.** Deploy the 3 detection operators on physically distinct hosts with independent RPC endpoints. | 1 engineer-day of ops. | Currently co-located containers with distinct seeds (1337/4242/9001) and `ModelRegistry` identities. K-of-N aggregation + quorum logic are real; physical separation isn't. | Before any customer pilot. |

All four are honest reframes rather than hidden risks — each is
flagged explicitly in `docs/judge-qa.md#known-limitations` so the
presenter doesn't get caught.
