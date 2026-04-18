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

### OpenClaw Layer

| Component | Role | Source |
|-----------|------|--------|
| `clawguard/` skill directory | Packaged OpenClaw skill with SKILL.md + handler | New |
| Hook registrar | Intercepts all tool calls that ingest outside content | New |
| Skill config | Per-node configuration (protected contracts, alert thresholds) | New |

### Pipeline A — Content Defense

| Component | Role | Source |
|-----------|------|--------|
| Content Extractor | Tesseract OCR, Whisper ASR, pdfplumber, PIL metadata | New |
| Rule Layer | 30+ regex patterns for known injection signatures | New |
| Classifier | Fine-tuned DistilBERT on prompt injection dataset | New |
| LLM Judge | GPT-4o-mini / Claude Haiku for ambiguous verdicts | New |
| Verdict Builder | Aggregates all three layers into `{verdict, confidence, reasons}` | New |

### Pipeline B — On-Chain Defense

| Component | Role | Source |
|-----------|------|--------|
| Mempool Monitor | Alchemy WS stream, filtered by protected contract address | SENTINEL |
| Feature Extractor | tx_features.py: loan amount, price deviation, selector, gas | SENTINEL |
| IsolationForest | Unsupervised anomaly scorer for individual transactions | SENTINEL |
| LSTM Sequence Detector | 2-layer PyTorch, classifies per-address tx windows | SENTINEL |
| State Machine | 4-state confidence machine (IDLE → CONFIRMED) | SENTINEL |
| Preemptive Strike | Fires PauseController before attacker tx mines | SENTINEL |

### Shared Infrastructure

| Component | Role | Source |
|-----------|------|--------|
| Redis Streams | Event bus between all internal services | SENTINEL |
| ThreatRegistry.sol | On-chain hash store for known attacks | SENTINEL (adapted) |
| DefenseProtocol.sol | On-chain store for published defense updates (rules + model deltas) | New |
| ConsensusVoting.sol | K-of-N quorum for validating defense updates before propagation | SENTINEL (adapted) |
| Federation Coordinator | Aggregates node verdicts, confirms quorum | SENTINEL |

### Learning Loop

| Component | Role | Source |
|-----------|------|--------|
| Red Agent | Bayesian GP optimizer, generates attack variations | SENTINEL |
| Blue Agent (MLP) | 5→8→4→1 neural net, trains against variations via backprop | SENTINEL |
| Rule Extractor | Converts confirmed variation patterns into new regex rules | New |
| Defense Publisher | Packages rules + model delta + ZK proof for on-chain publishing | New |

### ZK Layer

| Component | Role | Source |
|-----------|------|--------|
| ScanAttestation guest | RISC Zero guest that proves a scan ran correctly against committed policy | SENTINEL (adapted) |
| DefenseUpdateCorrectness guest | Proves a defense update was derived from a real caught attack | New |
| Groth16 Verifier | On-chain verification of both proof types | SENTINEL |

### Frontend

| Component | Role | Source |
|-----------|------|--------|
| ClawGuard Dashboard | Live feed: blocked content, threat map, network propagation, quorum status | New (React + shadcn) |
| Guardian Cards | Per-node status, recent verdicts, model generation | New |
| Threat Map | Network graph showing attack propagation and node immunity | New |

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
