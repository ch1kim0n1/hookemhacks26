# Spec vs implementation (living)

This ties **`absolute-docs/`** to what exists on `main`. Update this file when you close gaps or change stubs.

| Doc | Topic | Spec expectation | Code / notes |
|-----|--------|------------------|--------------|
| 03 | Redis `sentinel.*` streams | Catalog + publishers | Implemented; `pnpm run verify:streams` guards drift. Extra streams shipped: `sentinel.training.telemetry`, `sentinel.preemptive.signature`, `sentinel.preemptive.executed`, `sentinel.preemptive.alert`. |
| 03 | counterfactual after defense | Wait for defense mined | `COUNTERFACTUAL_WAIT_DEFENSE` (default on) in counterfactual-sim |
| 03 | preemptive-strike service | Doc 09 listed as "complete omission" | **Shipped & wired end-to-end.** `services/preemptive-strike` subscribes to three streams: `sentinel.mempool.pending` (match attacker+selector → fire `PauseController`), `sentinel.training.telemetry` (derive signatures from breached variants), and `sentinel.detection.confirmed` (cross-protocol immunity propagation: seeds matcher with reported attacker addresses + publishes signature to on-chain `ThreatRegistry`). 30-s dedup window. New demo endpoint `POST /api/v1/demo/preemptive` + `scripts/trigger-preemptive-demo.sh`. |
| 03 | Detection engine ML | Doc said heuristic only | **Shipped.** `anomaly_scorer.py`: IsolationForest fits on synthetic normal baseline at startup, scores individual tx anomaly in [0,1]. `sequence_detector.py`: 2-layer PyTorch LSTM trained on synthetic sequences, classifies per-EOA tx windows. Both scores blend into state machine confidence. |
| 03 | Red agent search | Doc said genetic algorithm | **Upgraded.** `bayesian-optimizer.ts`: Gaussian Process (RBF kernel) + UCB acquisition in 2D loan×price space. `RedAgent.observeResults()` feeds breach/defense outcomes back each generation. Converges 3–5× faster than random mutation on a uniform benchmark. |
| 03 | Blue agent (learning loop) | Doc said threshold tuning only | **Upgraded to real neural network.** `services/learning-loop/src/nn.ts`: 5→8→4→1 MLP with manual forward + backward pass, SGD + momentum, He init, L2 regularization, BCE loss. `neural-detector.ts` wraps the MLP with a physics-backed "ground truth" (constant-product slippage model with pool-depth damping) so training labels are genuine, not heuristic. Orchestrator trains the net each generation and publishes per-epoch `nn_training_start` / `nn_training_epoch` / `nn_training_complete` telemetry. `EvalHarness` fires defense when either the NN (above confidence threshold) OR the declarative thresholds (safety floor) match. Summary reports `nnRecall`, `nnPrecision`, `nnFalsePositiveRate` per generation. |
| 03 | Anvil fork port allocation | Unspecified | **Hardened.** `services/counterfactual-sim/src/fork.ts` now uses a pool-backed allocator (`acquirePort`/`releasePort`) with in-process reservation Set + physical `probePort` binding check. Range configurable via `ANVIL_PORT_POOL_START`/`ANVIL_PORT_POOL_END` (default 28545–28999). Eliminates the OS-assigned-port race between allocation and `spawn()`. |
| 04 | PolicyCompliance guest | RISC Zero guest + host | `zk/guest/policy-compliance` — real Groth16 via `ProverOpts::groth16()`; host emits seal via `encode_seal` |
| 04 | CounterfactualCorrectness | Full guest + verifier | Structured-claim guest (`zk/guest/counterfactual-correctness`) proves sum-of-deltas and SHA-256 Merkle-root consistency. Journal = **160 bytes / 5 slots**: `[eventId \| counterfactualRoot \| deltaWei \| victimProtocol \| forkBlockHash]`. Hybrid Approach A grounding (forkBlockHash binding to a real historical block) is **active**; full EVM re-execution inside the zkVM remains future work. |
| 04 | LearningLoopCorrectness | Doc 09 listed as cut | **Shipped.** `zk/guest/learning-correctness` proves aggregate win-rate floor across committed generations. ZK prover wires to `/prove/learning`; learning-loop orchestrator accumulates per-generation stats and calls the real prover endpoint when `ZK_PROVER_URL` is set. |
| 04 | Groth16 verifiers on-chain | Generated from circuits | Each sentinel wrapper (`PolicyVerifier`/`CounterfactualVerifier`/`LearningVerifier`) delegates to the canonical `RiscZeroGroth16Verifier` (dev: `RiscZeroMockVerifier`) with an image ID pinned at construction. Deploy script reads `config/zk-image-ids.json` produced by `zk/host/src/bin/dump_image_ids.rs`. |
| 04 | Proof cache | Postgres-backed | `proof_cache` table (migration 005), two-tier cache in `services/zk-prover/src/proof-cache.ts` (L1 in-memory LRU + L2 Postgres). Pre-warm all 3 circuits via `scripts/pre-warm-proofs.sh`. |
| 04 | CounterfactualCorrectness public inputs | Doc 04 listed 4 slots ending with `policyHash` | **Corrected.** Actual journal is 5 slots: `[eventId, counterfactualRoot, deltaWei, victimProtocol, forkBlockHash]`. No `policyHash` in counterfactual circuit. |
| 05 | Postgres migrations | Applied at api-gateway startup | **Hardened.** `services/api-gateway/src/db.ts`: connection backoff (exponential, 10 attempts), per-file SHA-256 checksums tracked in `schema_migrations`, transactional per-file apply, drift detection (refuses to re-run mutated files unless `SENTINEL_DB_ALLOW_RESET=1`), graceful recovery on idempotent-error codes `42P07`/`42710`/`42701`. |
| 05 | `config/addresses.local.json` freshness | Generated by `DeployLocal.s.sol` | **Guarded.** New `scripts/verify-addresses.mjs` + `pnpm run verify:addresses`: checks all 15 required keys present, addresses well-formed, and (when RPC reachable) that each address has on-chain bytecode. api-gateway additionally runs `probeAddressesOnChain()` at startup — a stale deployment file now fails loudly with a single actionable error instead of propagating through every downstream service. |
| 05 | Redis Sentinel HA | Production profile | `docker compose --profile production up` runs 1 master + 2 replicas + 3 sentinels. Hardened `config/redis/sentinel.conf`: quorum=2, hostname resolution, safe-reconfigure flags, `down-after 5s`, `failover-timeout 10s`. |
| 06 | REST + WS API | Gateway routes | Implemented under `services/api-gateway`. New route: `POST /api/v1/demo/preemptive` (seeds confirmed detection + replays attacker tx so both propagation and mempool-match paths fire). |
| 06 | Evidence export | Auditable receipt per event | **Shipped.** `GET /api/v1/evidence/:eventId/export` in `services/api-gateway/src/routes/evidence.ts` bundles detection → defense → counterfactual → ledger (+ approval record if present) into canonical JSON, SHA-256 digests it, and signs with ECDSA-secp256k1 (Anvil key in dev, `SENTINEL_EVIDENCE_KEY` in prod). Same `eventId` threads through every layer, so the bundle is re-verifiable offline against the same event envelopes the WS firehose already broadcasts. War-demo-room surfaces a `⤓ download signed evidence bundle` anchor once an `eventId` is adopted. |
| 06 | Human approval gate | Opt-in operator confirmation | **Shipped.** Streams: `sentinel.defense.pending_approval`, `sentinel.defense.approval`. Routes: `POST /api/v1/approvals/:eventId/approve` and `/reject`, plus `GET /api/v1/approvals` to list decisions. Defense-agent guard in `services/defense-agent/src/defense_agent/approval_gate.py` — when `SENTINEL_REQUIRE_APPROVAL=1` and confidence ≥ `SENTINEL_APPROVAL_THRESHOLD` (default 9500, i.e. 95%), it blocks tx submission on an `asyncio.Event`, then either submits or emits `DEFENSE_REJECTED` with `reason=OPERATOR_REJECTED` / `APPROVAL_TIMEOUT`. Timeout (`SENTINEL_APPROVAL_TIMEOUT_S`, default 90s) synthesises a reject — fail-closed by inaction. Frontend: amber pulsing banner in war-demo-room with live countdown + Approve/Reject buttons wired to the api-client. Off by default so the 2.4 ms detection story remains the baseline. |
| 07 | TrustInterface, graphs, timelines | Live components | `TrustInterface`, `AttackIntelGraph`, `DualTimelineViewer`, etc. |
| 07 | ProofViewer, TimeScrollAudit | Dedicated components | `ProofViewer` exists; `TimeScrollAudit` + `AppNav` wired |
| 07 | Learning-loop UI surfacing | Real-time NN metrics | Frontend `store.ts` tracks `neuralMetrics[]`, per-generation `nnRecall`/`nnPrecision`/`nnFalsePositiveRate`, and per-variant `nnConfidence` / `groundTruthAttack`. `ws.ts` consumes `nn_training_epoch` and `nn_training_complete` events. |
| 09 | MVP scope | Sliced delivery | All three circuits ship real Groth16 under `RISC0_DEV_MODE=0`. Learning-loop + preemptive-strike both live (previously cut per doc 09). |
| 12 | 90s demo + tiled finale | Choreography | Tiled view at `immunityPropagate` ms from `public/config/timings.json` on `/demo` |
| 11 | Testing | Unit + integration | Forge (mock-verifier fixture for real ZK path), Vitest (220+ tests across services — learning-loop 36, api-gateway 114, counterfactual-sim 13, preemptive-strike 7, etc.), pytest, `cargo test` with rzup. CI splits fast `zk` (dev mode) and opt-in `zk-full` (real Groth16 via `full-zk` label or tag push). |

## ZK toggle

`RISC0_DEV_MODE=1` (default for `pnpm dev`): the host emits Fake receipts with the `0xFFFFFFFF` selector; the deploy script deploys `RiscZeroMockVerifier(0xFFFFFFFF)`. Fast path, no cryptography.

`RISC0_DEV_MODE=0`: host emits real Groth16 seals; deploy script deploys `RiscZeroGroth16Verifier(ControlID.CONTROL_ROOT, ControlID.BN254_CONTROL_ID)`. Proofs take 30–60s each on local hardware — always pre-warm via `scripts/pre-warm-proofs.sh` before demo.

Switching modes requires a fresh deployment (verifier addresses change) and a cache flush (proofs from dev mode won't verify against the real verifier).

## Known limitations

- **Full EVM re-execution in counterfactual** — Hybrid Approach A (forkBlockHash grounding) is active; the guest proves claim consistency + binds to a real historical block. Full revm execution inside the zkVM is a documented roadmap item.
- **Bonsai remote proving** — `BONSAI_API_KEY` plumbing is in place; performance-tuning and retries not hardened.
- **NN proofs** — The learning-loop's MLP runs off-chain; the on-chain `LearningVerifier` proves aggregate win-rate, not the NN's forward pass. Proving a neural net inside the zkVM is deliberately out of scope.
- **#106** — Performance budgets (Lighthouse / CI perf) not automated.

## Quick verification

```bash
pnpm verify && pnpm test && cd contracts && forge test && cd ../zk && cargo test
bash scripts/soak-health.sh   # optional smoke (requires gateway up)
```
