# System Architecture

## High-Level Overview

ClawGuard operates as two parallel defense pipelines unified under a single OpenClaw skill. Pipeline A intercepts content-level attacks (prompt injection through external data sources). Pipeline B monitors the blockchain mempool for protocol-level attacks (on-chain exploits). Both pipelines feed into a shared learning loop and a shared on-chain threat registry.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OUTSIDE WORLD                               │
│                                                                     │
│  [Webpage]  [PDF/Doc]  [Email]  [Image]  [Audio]  [Blockchain]      │
└──────┬───────────┬────────┬──────────┬──────┬──────────┬────────────┘
       │           │        │          │      │          │
       └───────────┴────────┴──────────┴──────┘          │
                            │                             │
                     PIPELINE A                    PIPELINE B
                  Content Intercept            Mempool Monitor
                            │                             │
               ┌────────────▼──────────┐    ┌────────────▼──────────┐
               │  Content Extractor    │    │  Mempool Stream       │
               │  OCR / ASR / PDF /    │    │  (Alchemy WS or RPC   │
               │  image metadata       │    │   filtered by addr)   │
               └────────────┬──────────┘    └────────────┬──────────┘
                            │                             │
               ┌────────────▼──────────┐    ┌────────────▼──────────┐
               │  Injection Detector   │    │  Exploit Detector     │
               │  Rule layer           │    │  IsolationForest      │
               │  + Classifier         │    │  + LSTM sequence      │
               │  + LLM judge          │    │  + state machine      │
               └────────────┬──────────┘    └────────────┬──────────┘
                            │                             │
                            └──────────┬──────────────────┘
                                       │
                          ┌────────────▼──────────────┐
                          │   ThreatRegistry Lookup   │
                          │   (on-chain hash check)   │
                          └────────────┬──────────────┘
                                       │
                          ┌────────────▼──────────────┐
                          │       Decision Engine     │
                          │  pass / sanitize / block  │
                          │  / trigger on-chain defense│
                          └────────────┬──────────────┘
                                       │
               ┌───────────────────────┼───────────────────────┐
               │                       │                       │
        CLEAN CONTENT          SELF-LEARNING LOOP       DEFENSE ACTION
        → OpenClaw Agent       (if attack caught)       (if on-chain)
                               │                       PauseController
                    ┌──────────▼──────────┐
                    │  Red Agent          │
                    │  Variation Generator│
                    │  (Bayesian GP)      │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Blue Agent         │
                    │  MLP Defense Model  │
                    │  (backprop update)  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Defense Publisher  │
                    │  New rules +        │
                    │  model delta +      │
                    │  ZK attestation     │
                    │  → on-chain         │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Network Propagation│
                    │  Other ClawGuard    │
                    │  nodes pull update  │
                    └─────────────────────┘
```

---

## Component Inventory

### OpenClaw Layer (in `skill/`)

| Component | Role | File |
|-----------|------|------|
| Skill manifest | SKILL.md declares hooks and dependencies | `skill/SKILL.md` |
| Hook registrar | Intercepts pre_tool calls from OpenClaw | `skill/handler.py` + `skill/hook_registrar.py` |
| Skill API | FastAPI dashboard and admin endpoints | `skill/api.py` |
| Config loader | Per-node configuration and secrets | `skill/config/` |
| Event storage | SQLite audit log for all verdicts | `skill/db.py` |

### Pipeline A — Content Defense (in `detector/` + `skill/detectors/`)

| Component | Role | File |
|-----------|------|------|
| Content Extractor | OCR, ASR, PDF parse, HTML strip | `extractor/` (text, image, pdf, audio, router) |
| Rule Layer | 30+ regex patterns for injection signatures | `detector/rules.py` |
| ML Classifier | DeBERTa-v3 prompt injection detector | `detector/classifier.py` |
| LLM Judge | GPT-4o-mini / Claude for ambiguous cases | `detector/llm_judge.py` |
| Verdict Aggregator | Combines all layers | `detector/verdict.py` + `skill/detectors/pipeline.py` |

### Pipeline B — On-Chain Defense (in `blockchain/`)

| Component | Role | File |
|-----------|------|------|
| Mempool Monitor | Alchemy WS stream, filtered by protected contracts | `blockchain/mempool_monitor.py` |
| Feature Extractor | tx_features: loan amount, price deviation, selector, gas | `blockchain/on_chain_detection.py` |
| IsolationForest | Unsupervised anomaly scorer for individual transactions | `blockchain/on_chain_detection.py` |
| LSTM Sequence Detector | 2-layer PyTorch, classifies per-address tx windows | `blockchain/on_chain_detection.py` |
| State Machine | 4-state confidence machine (IDLE → CONFIRMED) | `blockchain/on_chain_detection.py` |
| Preemptive Strike | Fires PauseController before attacker tx mines | `blockchain/preemptive_strike.py` |
| Async RPC Client | JSON-RPC transport for chain interactions | `blockchain/async_client.py` |

### Shared Infrastructure (on-chain)

| Component | Role | File |
|-----------|------|------|
| ThreatRegistry | On-chain hash store for known attacks | `contracts/src/ThreatRegistry.sol` |
| DefenseProtocol | On-chain store for published defense updates | `contracts/src/DefenseProtocol.sol` |
| ConsensusVoting | K-of-N quorum for validating defense updates | `contracts/src/ConsensusVoting.sol` |
| PauseController | Emergency pause mechanism for protected protocols | `contracts/src/PauseController.sol` |

### Learning Loop (in `learning/`)

| Component | Role | File |
|-----------|------|------|
| Red Agent | Bayesian GP optimizer, generates attack variations | `learning/red_agent.py` |
| Bayesian Optimizer | Gaussian Process optimization for variant search space | `learning/bayesian_opt.py` |
| Blue Agent (MLP) | 5→8→4→1 neural net, trains via backprop | `learning/blue_agent.py` |
| Feature Extractor | Attack feature vectors for blue agent training | `learning/features.py` |
| Rule Extractor | Converts variation patterns into new regex rules | `learning/rule_extractor.py` |
| Orchestrator | Coordinates red→blue round and orchestrates publishing | `learning/orchestrator.py` |
| Defense Publisher | Packages rules + model delta + ZK proof | `learning/publisher.py` |

### Network Coordination (in `network/`)

| Component | Role | File |
|-----------|------|------|
| Network Poller | Polls ThreatRegistry and DefenseProtocol for updates | `network/poller.py` |
| Defense Applier | Applies received defense updates with ZK verification | `network/applier.py` |
| Threat Cache | Local SQLite cache of known attack hashes | `skill/db.py` |

### ZK Layer (in `zk/`)

| Component | Role | File |
|-----------|------|------|
| DefenseUpdateCorrectness circuit | RISC Zero guest proving defense update legitimacy | `zk/guest/defense-update-correctness` |
| Prover | Groth16 proof generation and caching | `zk/prover.py` |
| On-chain Verifier | Groth16 verification | `contracts/src/RiscZeroGroth16Verifier.sol` |

### Frontend

| Component | Role | File |
|-----------|------|------|
| ClawGuard Dashboard | Live feed: blocked content, threat map, network graph | `frontend/src/` |
| Guardian Cards | Per-node status, recent verdicts, model generation | `frontend/src/components/` |
| Threat Visualization | Network graph showing attack propagation | `frontend/src/components/` |

---

## Data Flow: Attack Caught and Propagated

```
1. User tells OpenClaw: "go to news.example.com and read today's headlines"
2. OpenClaw's web_fetch tool fires
3. ClawGuard hook intercepts before content reaches the agent
4. Content Extractor pulls text, checks image layers, scans metadata
5. Rule Layer fires on "IGNORE ALL PREVIOUS INSTRUCTIONS" → flagged
6. Classifier confirms: confidence 0.94, category: direct_injection
7. LLM Judge: "yes, this is attempting to hijack agent behavior"
8. Verdict: BLOCK — content never reaches OpenClaw agent
9. Attack hash published to ThreatRegistry on Base Sepolia
10. Red Agent generates 12 variations of the attack pattern
11. Blue Agent MLP trains on variations, updates weights
12. Rule Extractor derives 2 new regex rules from confirmed variations
13. Defense Publisher packages: new rules + model weight delta + ZK proof
14. ConsensusVoting quorum (K-of-N) validates the update
15. DefenseProtocol contract records the validated update on-chain
16. All other ClawGuard nodes poll DefenseProtocol, pull update
17. Every node now blocks the original attack AND its 12 variations
18. Reporter receives x402 bounty payment for publishing the new attack hash
```

---

## Deployment Topology

```
                    ┌─────────────────────┐
                    │   Base Sepolia       │
                    │                     │
                    │  ThreatRegistry     │
                    │  DefenseProtocol    │
                    │  ConsensusVoting    │
                    │  PauseController    │
                    │  x402 Bounty        │
                    └──────────┬──────────┘
                               │ on-chain reads/writes
          ┌────────────────────┼────────────────────┐
          │                    │                    │
   ┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐
   │ Node Alpha  │      │ Node Beta   │      │ Node Gamma  │
   │ OpenClaw +  │      │ OpenClaw +  │      │ OpenClaw +  │
   │ ClawGuard   │      │ ClawGuard   │      │ ClawGuard   │
   │             │      │             │      │             │
   │ Pipeline A  │      │ Pipeline A  │      │ Pipeline A  │
   │ Pipeline B  │      │ Pipeline B  │      │ Pipeline B  │
   │ Redis       │      │ Redis       │      │ Redis       │
   │ SQLite      │      │ SQLite      │      │ SQLite      │
   └─────────────┘      └─────────────┘      └─────────────┘
```

Each node is fully independent. The blockchain is the only shared state. Nodes do not communicate directly — all coordination happens on-chain. This means the network has no central point of failure and cannot be taken down by attacking any individual node.
