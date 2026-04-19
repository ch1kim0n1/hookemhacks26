# Implementation Map

## What Carries Over from SENTINEL v2

This table maps every major component of the SENTINEL v2 backend to its status in ClawGuard. "Direct reuse" means copy the file and point it at new config. "Adapted" means the logic is the same but the domain changes (e.g., mempool features → content features). "New" means built from scratch.

### Blockchain Contracts

| SENTINEL v2 Component | ClawGuard Component | Status |
|----------------------|--------------------|----|
| `ThreatRegistry.sol` | `ThreatRegistry.sol` | **Direct reuse** — adds `getAttacksSince(fromIndex)` pagination and x402 bounty call |
| `PolicyRegistry.sol` | `DefenseProtocol.sol` | **Adapted** — stores defense updates instead of policy versions |
| `FederationVerifier.sol` / quorum logic | `ConsensusVoting.sol` | **Adapted** — same K-of-N quorum, now for defense update validation |
| `PauseController.sol` | `PauseController.sol` | **Direct reuse** |
| `VictimLendingPool.sol` | `VictimLendingPool.sol` | **Direct reuse** — same demo target contract |
| `CounterfactualLedger.sol` | Removed | Not needed in ClawGuard |
| `SentinelGuard.sol` | Removed | Replaced by `DefenseProtocol.sol` |

### Services — Pipeline B (On-Chain)

| SENTINEL v2 Service | ClawGuard Module | Status |
|--------------------|-----------------|--------|
| `services/mempool-monitor` | `blockchain/mempool.py` | **Direct reuse** — renamed, same Alchemy WS logic |
| `services/detection-engine` (IsolationForest + LSTM) | `detector/on_chain.py` | **Direct reuse** — same models, same state machine |
| `services/defense-agent` | `blockchain/defense.py` | **Direct reuse** |
| `services/preemptive-strike` | `blockchain/preemptive.py` | **Direct reuse** |
| `services/federation-coordinator` | Merged into `ConsensusVoting.sol` | **Simplified** — on-chain quorum replaces off-chain coordinator for defense updates |

### Services — Learning Loop

| SENTINEL v2 Service | ClawGuard Module | Status |
|--------------------|-----------------|--------|
| `services/learning-loop/src/red-agent.ts` | `learning/red_agent.py` | **Adapted** — Bayesian GP now searches prompt injection parameter space in addition to loan/price space |
| `services/learning-loop/src/nn.ts` (MLP) | `learning/blue_agent.py` | **Direct reuse** — same 5→8→4→1 MLP, same backprop. Now also used for content classifier updates |
| `services/learning-loop/src/bayesian-optimizer.ts` | `learning/bayesian_opt.py` | **Direct reuse** — ported to Python |
| Learning loop orchestrator | `learning/orchestrator.py` | **Adapted** — unified loop handles both Pipeline A and B learning |

### ZK Layer

| SENTINEL v2 Component | ClawGuard Component | Status |
|----------------------|--------------------|----|
| `zk/guest/policy-compliance` | `zk/guest/scan-attestation` | **Adapted** — proves content scan ran correctly instead of policy compliance |
| `zk/guest/counterfactual-correctness` | Removed | Not needed |
| `zk/guest/learning-correctness` | `zk/guest/defense-update-correctness` | **Adapted** — proves defense update derived from real attack |
| `services/zk-prover` (proof cache, Groth16 host) | `zk/prover.py` | **Direct reuse** |
| `RiscZeroGroth16Verifier` integration | Same | **Direct reuse** |

### Infrastructure

| SENTINEL v2 Component | ClawGuard Component | Status |
|----------------------|--------------------|----|
| Redis Streams event bus | `store/redis_bus.py` | **Direct reuse** |
| Postgres + migrations | `store/sqlite.py` | **Simplified** — SQLite per node (Postgres was over-engineered for single-node) |
| `services/api-gateway` (REST + WS) | `api/gateway.py` | **Adapted** — new routes for ClawGuard dashboard |
| Prometheus + Grafana infra | Kept for production profile | **Direct reuse** |
| Docker Compose | `docker-compose.yml` | **Adapted** — fewer services, simpler topology |

---

## What Is Net New

These components do not exist in SENTINEL v2 and must be built:

| Component | File | Priority | Status |
|-----------|------|----------|--------|
| OpenClaw skill manifest | `skill/SKILL.md` | **Critical** | ✅ Implemented |
| Hook registrar | `skill/handler.py` + `skill/hook_registrar.py` | **Critical** | ✅ Implemented |
| Text extractor | `extractor/text.py` | **Critical** | ✅ Implemented |
| PDF extractor | `extractor/pdf.py` | **Critical** | ✅ Implemented |
| Image extractor (OCR) | `extractor/image.py` | **High** | ✅ Implemented |
| Audio extractor | `extractor/audio.py` | **Low** | ✅ Implemented |
| Rule layer (30+ patterns) | `detector/rules.py` | **Critical** | ✅ Implemented |
| DeBERTa classifier | `detector/classifier.py` | **High** | ✅ Implemented |
| LLM judge | `detector/llm_judge.py` | **High** | ✅ Implemented |
| Verdict aggregator | `detector/verdict.py` + `skill/detectors/pipeline.py` | **Critical** | ✅ Implemented |
| Rule extractor (from variations) | `learning/rule_extractor.py` | **High** | ✅ Implemented |
| Red agent (Bayesian GP) | `learning/red_agent.py` + `learning/bayesian_opt.py` | **High** | ✅ Implemented |
| Blue agent (MLP) | `learning/blue_agent.py` | **High** | ✅ Implemented |
| Learning orchestrator | `learning/orchestrator.py` | **High** | ✅ Implemented |
| Defense publisher | `learning/publisher.py` | **High** | ✅ Implemented |
| Network poller | `network/poller.py` | **Critical** | ✅ Implemented |
| Defense update applier | `network/applier.py` | **Critical** | ✅ Implemented |
| Async RPC client | `blockchain/async_client.py` | **Critical** | ✅ Implemented |
| Mempool monitor | `blockchain/mempool_monitor.py` | **High** | ✅ Implemented |
| On-chain detection | `blockchain/on_chain_detection.py` | **High** | ✅ Implemented |
| ThreatRegistry contract | `contracts/src/ThreatRegistry.sol` | **Critical** | ✅ Deployed |
| DefenseProtocol contract | `contracts/src/DefenseProtocol.sol` | **Critical** | ✅ Deployed |
| ConsensusVoting contract | `contracts/src/ConsensusVoting.sol` | **Critical** | ✅ Deployed |
| PauseController contract | `contracts/src/PauseController.sol` | **Critical** | ✅ Deployed |
| Threat Registry RPC client | `skill/chain/threat_registry.py` | **Critical** | ✅ Implemented |
| SQLite event store | `skill/db.py` | **Critical** | ✅ Implemented |
| Dashboard (React) | `frontend/` | **Critical** | ✅ Implemented |
| Local skill tests | `skill/tests/`, `tests/` | **High** | ✅ Implemented |

---

## Build Order

Given the demo is the deliverable, build backwards from it:

**Phase 1 — Contracts and chain (Day 1)**
Deploy `ThreatRegistry`, `DefenseProtocol`, `ConsensusVoting`, `PauseController`, `VictimLendingPool` to Base Sepolia. Verify all addresses. Confirm `publishAttack` and `isKnownAttack` work end-to-end.

**Phase 2 — Core detection (Day 1–2)**
Build the rule layer and verdict aggregator first — these are the fastest to implement and form the backbone of Moment 2 in the demo. Add the LLM judge next (one API call). Add the classifier last (needs training data download and fine-tuning time).

**Phase 3 — OpenClaw integration (Day 2)**
Wire the hook registrar. Prove end-to-end: OpenClaw fetches URL → hook fires → ClawGuard runs detection → verdict returned to agent.

**Phase 4 — PDF extraction (Day 2)**
pdfplumber is fast to integrate. This is needed for Scenario B. Add image OCR if time permits.

**Phase 5 — Learning loop (Day 3)**
Port red agent and blue agent from SENTINEL v2. Wire them to fire after a BLOCK verdict. Verify that a caught attack produces a valid defense update that can be published.

**Phase 6 — Network propagation (Day 3)**
Build the poller and applier. Verify that Node Alpha's published defense update reaches Node Beta within one poll interval.

**Phase 7 — Dashboard (Day 3–4)**
Build the React dashboard. This is the demo's visual centerpiece. Priority components: live blocked feed, per-scenario attack card, threat propagation graph, learning loop generation counter.

**Phase 8 — ZK layer (Day 4, if time)**
Wire `ScanAttestation` and `DefenseUpdateCorrectness` circuits. Pre-warm proofs. This is the differentiator but not the blocker — demo works without it in dev mode.

**Phase 9 — Demo rehearsal (Day 4–5)**
Run the full demo end-to-end at least 10 times. Record backup video. Test fallback paths.

---

## Minimum Viable Demo (if time is short)

If only two days remain, cut to this scope and still win Moment 2:

- Rule layer only (no classifier, no LLM judge) — fast to build, covers the core demo
- Text injection scenario only (no PDF, no audio)
- No learning loop (static rules, no self-healing)
- `ThreatRegistry` hash lookup working (the cross-node propagation story)
- Two nodes showing hash propagation

The demo still shows: agent gets owned → ClawGuard blocks it → attack hash propagates to second node → second node blocks same attack instantly. That's the core thesis, and it's demonstrable in this scope.
