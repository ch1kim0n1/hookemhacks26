# Judge Q&A — SENTINEL v2

Concise answers for hackathon judging.

## What problem does this solve?

Autonomous, policy-bounded defense against mempool-level threats (e.g. flash-loan style attacks): detect suspicious transactions early, simulate counterfactual outcomes, and record proofs + ledger entries for auditability.

## What is the product / company story?

**DeFi is the first customer**, not the only market. The underlying primitive is **cryptographically bound autonomous agents**: model weights and policy are committed; the zkVM refuses to seal if the action is not authorized; the chain verifies Groth16 proofs. That pattern generalizes to any high-stakes agent (RWA settlement, insurance payouts, compliance automation). The hackathon build proves the stack on public mempool data and measurable TVL; vertical expansion is a GTM question, not a technology gap.

## Private bundles / Flashbots / builder order flow — does SENTINEL still matter?

**Yes, with the right framing.** Public mempool monitoring catches the long tail of opportunistic attackers and keeps the **preemptive strike + ThreatRegistry** path honest for protocols that share intelligence. Sophisticated actors may use private bundles; **cross-protocol immunity** still applies: a signature observed anywhere in the federation propagates so a replay against a sibling protocol is paused before it mines. The honest one-sentence answer: *“We don’t claim to see every private bundle; we claim that once a pattern is confirmed, every connected protocol can reject it before execution — and the proof pipeline is the same.”*

## What is novel?

Six compounding layers:

1. **IsolationForest anomaly detector + PyTorch LSTM sequence classifier** in the detection engine — genuine ML inference over mempool transactions, not heuristic rules.
2. **Gaussian Process Bayesian optimizer** in the adversarial training loop — finds defense-boundary gaps 3–5× faster than random mutation.
3. **Real neural network in the Blue agent** — a hand-rolled 5→8→4→1 MLP trained each generation via backprop (SGD + momentum) against a physics-grounded flash-loan simulator. Reports live loss, accuracy, precision, recall, FPR.
4. **Preemptive strike engine** (Layer 6) — fires `PauseController` the moment an attack tx appears in the mempool, **before** it's mined.
5. **ZK-proven policy compliance** (RISC Zero Groth16) — every defense action and policy update cryptographically verifiable on-chain.
6. **Counterfactual simulation** bound to a real historical block hash (Hybrid Approach A) — a tamper-evident "prevented loss" record.

## How do you demo in 90 seconds?

Follow `absolute-docs/12_demo_playbook.md`. The `/demo` route runs choreographed tiles (Trust Interface, battlefield, immunity map, attack graph, dual timeline) driven by `config/timings.json`. One click in the UI, or one curl:

```bash
curl -X POST http://localhost:8080/api/v1/demo/replay-scenario
# or preemptive-only:
./scripts/trigger-preemptive-demo.sh
```

## Is everything on-chain?

No — the heavy ML models (IsolationForest, LSTM, MLP) run off-chain by design; attempting to execute a 2-layer LSTM forward pass inside a zkVM is an order of magnitude past the hackathon's proving budget. Commitments, policy registry, threat registry, pause controller, counterfactual ledger, and verifiers are on-chain; proofs verify policy/learning/counterfactual claims per `absolute-docs/04_zk_proof_system.md`.

## Where does AI run *on-chain*?

In the **PolicyCompliance guest**. A fixed-point linear classifier with
weights committed in `policyHash` evaluates the evidence features
inside the zkVM. No Groth16 seal is emitted unless the classifier's
score clears the policy threshold. That means the on-chain verifier
is cryptographically bound to the exact model that ran: a malicious
operator cannot substitute a different classifier without changing
`policyHash`, and changing `policyHash` requires a `LearningLoopCorrectness`
proof. This is the co-processor pattern — the heavy models guide
decisions off-chain, but the **inference that gates the action**
runs inside the proof the chain verifies. See
`zk/guest/policy-compliance/src/main.rs` §3b.

## Is the ZK real or mocked?

Real. All three circuits (`PolicyCompliance`, `CounterfactualCorrectness`, `LearningLoopCorrectness`) run under `ProverOpts::groth16()` and produce Groth16 seals via `risc0_ethereum_contracts::encode_seal`. On-chain, each sentinel-specific verifier wraps the canonical `RiscZeroGroth16Verifier` and pins the matching image ID at construction, so a different guest ELF cannot spoof a valid proof.

For demos we ship a `RISC0_DEV_MODE=1` toggle that swaps in `RiscZeroMockVerifier` and emits fake seals (sub-second) so the 90-second choreography stays on budget. The contract surface and off-chain API are identical across modes. Set `RISC0_DEV_MODE=0`, redeploy, and pre-warm via `scripts/pre-warm-proofs.sh` for cryptographic proofs.

## How does the proof cache work?

Two tiers. L1 is an in-memory LRU inside `zk-prover`; L2 is the Postgres `proof_cache` table (migration 005). Cache key is the SHA-256 of canonical-JSON guest inputs, scoped by circuit. `pre-warm-proofs.sh` seeds L2 with the three demo scenarios before the pitch so live requests are byte-identical cache hits.

## What does CounterfactualCorrectness actually prove?

Structural consistency of the simulator's claim, not EVM re-execution. The guest takes a set of per-leaf balance deltas and a claimed aggregate, verifies their sum matches, and commits a SHA-256 Merkle root over the leaves. The journal also commits the **fork block hash** (Hybrid Approach A) — binding the proof to a specific real on-chain block without requiring full revm execution inside the zkVM. Full revm execution is a documented roadmap item.

## What is the preemptive strike engine?

Layer 6: the `preemptive-strike` service subscribes to **three** Redis streams:

1. **`sentinel.mempool.pending`** — every pending tx. If `to` matches a known attacker contract and the 4-byte selector matches (`attack(address,uint256)`), it calls `PauseController.activate()` before the attack tx mines.
2. **`sentinel.training.telemetry`** — when the learning loop reports breached variants, the engine derives a signature and publishes it to the on-chain `ThreatRegistry`.
3. **`sentinel.detection.confirmed`** — when the main detection pipeline confirms a threat, the engine seeds its matcher with the reported attacker addresses so the same pattern is caught preemptively on **sibling protocols** (federation propagation), and publishes the signature.

A 30-second dedup window prevents flooding. The attacker-pattern registry is seeded at startup from `addresses.local.json`, then kept hot by the three stream subscriptions.

## Does this use real AI / machine learning?

Yes, in **three** places:

1. **Detection engine (Python, sklearn + PyTorch).**
   - `IsolationForest` (unsupervised): fitted at startup on synthetic normal-traffic baseline; scores individual transactions for anomalousness in [0, 1] based on loan size, price deviation, gas price, selector entropy, and oracle targeting.
   - `LSTM sequence detector` (2-layer, trained on synthetic flash-loan sequences): classifies per-EOA transaction windows as attack (1) or normal (0).

2. **Adversarial training loop / Red agent (TypeScript).** A **Gaussian Process Bayesian optimizer** (RBF kernel, UCB acquisition) searches the attack parameter space in 2D (loan factor × price-manipulation factor), replacing naive random mutation. 3–5× faster convergence on the benchmark.

3. **Adversarial training loop / Blue agent (TypeScript).** A hand-written **multilayer perceptron** — 5→8→4→1 with ReLU hidden layers and sigmoid output, trained with manual backprop each generation: SGD + Nesterov-style momentum, He-initialized weights, L2 regularization, BCE loss, mini-batch training. The training signal is a **physics-grounded** attack simulator (constant-product AMM with pool-depth damping) so labels are genuine outcomes, not rule-based proxies. The orchestrator publishes per-epoch loss/accuracy and per-generation recall/precision/FPR to the UI live.

The heavy models (IsolationForest, LSTM, MLP) run off-chain; a **trained 5→4→1 MLP with ReLU** gates the defense action **inside** the PolicyCompliance zkVM guest (see "Where does AI run on-chain?"). Aggregate learning-loop outcomes are separately proven by the `LearningLoopCorrectness` circuit.

### Benchmark honesty — selector-flag ablation

A fair critique of our 8/8 historical-exploit replay is that it includes a boolean `is_known_selector` feature that matches the 4-byte selector of the reconstructed attack contract. If that single flag were carrying the detection, the 100% catch rate would be "strcmp with extra steps." So we ran the ablation and published the result.

| Run | Catches | False positives | p50 latency |
|---|---|---|---|
| Full feature set | **8/8** | 0/500 | 2.4 ms |
| `is_known_selector` forced `False` | **8/8** | 0/500 | 2.4 ms |

The catch rate survives the ablation unchanged. The signal is carried by the anomalous flash-loan size, the flash-loan-provider hop, and the oracle-deviation feature — the ML is doing the work, not the selector match. Reproduce with: `cd services/detection-engine && poetry run python -m bench.ablation`. Results checked in at [`bench/results/ablation.json`](../services/detection-engine/bench/results/ablation.json).

## How do the Red and Blue agents actually learn?

- **Red (attacker)** samples attack parameters `(loanFactor, priceFactor)` from a Gaussian-process posterior over past outcomes; after ≥3 observations it generates half the population from the GP + UCB suggestion, half random (exploration). It mutates survivors (breached variants) genetically in early generations.
- **Blue (defender)** runs every variant through the physics simulator to get a ground-truth attack/benign label, then appends to a 2000-sample training buffer. Each generation, it runs 3 epochs of backprop with minibatch size 8. Its forward pass is the real-time attack detector.
- The **EvalHarness** fires defense when either the NN (confidence ≥ policy-configurable threshold, default 0.5) **or** the declarative rule thresholds fire — so we keep a safety floor while the net is still learning.

## What's the on-chain surface?

Nine contracts:

- `PolicyRegistry` — authority for authorized defense actions; verifies ZK policy proof
- `CounterfactualLedger` — immutable record of defensive actions + deltas with ZK proof
- `ThreatRegistry` — on-chain registry of threat signatures (TTL-aware, operator-scoped, used by preemptive strike)
- `PauseController` — emergency pause; called by preemptive strike and defense agent
- `FederationVerifier` — verifies K-of-N operator quorum signatures
- `ModelRegistry` — on-chain registry of detection model versions
- `SentinelGuard` — guard hooks for protected protocols
- `VictimLendingPool` — demo target (flash-loan oracle manipulation)
- `QuarantineVault` — fund isolation during active threats

Plus three Groth16 verifier wrappers (Policy/Counterfactual/Learning) each pinning their image ID.

## Failure modes?

- **RPC lag** — services back off and retry; `/health` turns yellow.
- **Prover timeout** — `config/timings.json` caps wait; L1/L2 cache fallback.
- **Redis disconnect** — consumers auto-reconnect with exponential backoff.
- **Postgres schema drift** — migration runner detects checksum mismatch and refuses to re-run unless `SENTINEL_DB_ALLOW_RESET=1`. Service starts anyway for read paths.
- **Stale `addresses.local.json`** — api-gateway probes each contract via `eth_getCode` at startup and fails fast with a single actionable error (`forge script contracts/script/DeployLocal.s.sol --rpc-url … --broadcast`). `pnpm run verify:addresses` does the same check from the CLI.
- **Concurrent Anvil forks** — counterfactual-sim uses a reserved port pool (default 28545–28999) with in-process locking + physical bind probe, so simultaneous counterfactuals never collide.

All services expose `/health` and Prometheus `/metrics`. `docker compose --profile production up` replaces single-Redis with the HA Sentinel topology (1 master + 2 replicas + 3 sentinels).

## What happens when a defense proof is refused — is that a failure mode or a feature?

It's the safety boundary doing its job. When the zkVM refuses to produce a `PolicyCompliance` seal — for example an operator-injected instruction that doesn't match any rule in the policy — the agent emits `DEFENSE_REJECTED` with `reason=POLICY_REFUSAL`, and the UI surfaces the line **"FAIL CLOSED — policy proof refused. No tx was sent."** That's deliberate language: a rejected proof is not an error, it's a cryptographic refusal. The contract never receives a verifier call, so nothing revertable ever reaches the chain. Detection → prover → revert is covered by Moment 2 of the demo script; the wording also appears in `services/defense-agent/src/defense_agent/constraint_failure.py` and the cue pipeline in `services/api-gateway/src/cues.ts`.

## Is there a human in the loop for high-confidence defenses?

Optionally, yes — behind a flag. The default hot path is fully autonomous: that's the 2.4 ms detection story. When operators run `defense-agent` with `SENTINEL_REQUIRE_APPROVAL=1`, the agent publishes `sentinel.defense.pending_approval` and blocks on an `asyncio.Event` before tx submission. Two endpoints (`POST /api/v1/approvals/:eventId/approve` and `/reject`) release or refuse the held tx; a timeout (default 90s via `SENTINEL_APPROVAL_TIMEOUT_S`) synthesises a **reject**, so inaction is fail-closed by construction. The war-demo-room surfaces a pulsing amber banner with a live countdown and Approve/Reject buttons wired to those endpoints, so the claim "a human was in the loop" is demonstrable, not just configured. Who decided, when, and any note are persisted and surface in the evidence export. See `services/defense-agent/src/defense_agent/approval_gate.py`.

## How does a judge or auditor verify what happened offline?

Every run exposes `GET /api/v1/evidence/:eventId/export` — a single canonical-JSON bundle that threads the same `eventId` through detection → defense → counterfactual root → ledger entry (plus the operator approval record if one exists). The bundle is SHA-256 digested and signed with ECDSA-secp256k1 by the gateway's evidence key (Anvil account #0 in dev; `SENTINEL_EVIDENCE_KEY` in production). The same event envelopes are broadcast live on the WS firehose, so a fresh consumer can reproduce the bundle byte-for-byte by replaying the stream. Inside the UI it's the `⤓ download signed evidence bundle` anchor under the Attack Pipeline panel, once an `eventId` has been adopted. See `services/api-gateway/src/routes/evidence.ts`.

## Security model?

Defense agent keys are high-value; demo uses Anvil burners only. JWT + RBAC for operator API (roles: admin, operator, viewer); `x-demo-token` for read-only demo WebSocket/REST paths. Every privileged API call is appended to the `audit_log` table via a Fastify `onResponse` hook. Row-level security policies (migration 002) scope every query by `app.current_tenant_id`. Never ship default secrets from `.env.example` to production.

---

## Known limitations (presenter reads before every demo)

These are the things a technical judge *will* catch. Better that the
presenter raises them first with the correct framing.

### Counterfactual proof semantics
`CounterfactualCorrectness` verifies Merkle-root + delta-sum consistency
of the simulator's output and binds the proof to a real historical
block hash (Hybrid Approach A). It does **not** re-execute the EVM
inside the zkVM to verify that the simulator's outputs are *correct*.
Full in-circuit EVM re-execution is tracked in
`docs/post-hackathon-roadmap.md`. If a judge asks "how do I know your
simulator is accurate?", the correct answer is: *"Approach A grounds
the simulation to a real block; full re-execution is the honest next
step. What we prove today is tamper-evidence and reproducibility — not
soundness of the simulator."*

### Federation topology
The 3 detection operators run as separate containers on the **same host**, sharing one Anvil RPC and one Redis instance (seeds `1337/4242/9001`, operator IDs `alpha/beta/gamma`). The K-of-N aggregation logic, `ModelRegistry` identity, and quorum voting are real; the *physical separation* is not. Frame this as **"federation-ready architecture, co-located for the demo"** — never claim it's geographically distributed. Cross-host deployment is one day of ops work, tracked in the post-hackathon roadmap.

### On-chain inference scope
A trained 5→4→1 MLP with ReLU runs inside the PolicyCompliance zkVM guest (weights in `policyHash`). The heavier models — IsolationForest, LSTM, and the learning-loop MLP — run **off-chain**. Putting a 2-layer LSTM forward pass inside a Groth16 proof is an order of magnitude beyond the hackathon's proving budget. The on-chain model is an **action gate**, not the full detection stack. That's the co-processor pattern: heavy inference off-chain, policy-bounded gate inference on-chain, ZK links them.

### Benchmark caveat (resolved)
The 8-historical-exploit replay catches 8/8 with the full feature set *and* with `is_known_selector` forced `False` (see "Benchmark honesty — selector-flag ablation" above). Both numbers are published; the ablation file is `services/detection-engine/bench/results/ablation.json`. The raw "100%" figure alone is not a generalization claim — the ablation is what backs it up.
