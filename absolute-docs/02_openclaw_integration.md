# OpenClaw Integration

## What OpenClaw Is

OpenClaw is an open-source autonomous AI agent that executes real tasks on a user's computer and across external services — not just chat. When a user tells OpenClaw "go read that PDF and summarize it" or "check my email and execute the trade instructions", OpenClaw uses tools to fetch, read, and act. Those tool calls are the attack surface ClawGuard defends.

## How Skills Work in OpenClaw

OpenClaw skills are packaged as a directory containing a `SKILL.md` file (which defines what the skill does and how to invoke it) and a handler (Python or TypeScript). Skills can register hooks — functions that fire automatically before or after specific tool calls — without the user or the agent needing to explicitly invoke them. ClawGuard uses this hook system to insert itself transparently into every tool call that ingests outside content.

## ClawGuard Skill Structure

```
skill/
├── SKILL.md              ← skill manifest and capability description
├── handler.py            ← hook registrar and main entry point
├── detectors/
│   ├── rules.py          ← regex rule layer (30+ patterns)
│   ├── classifier.py     ← DeBERTa-v3 prompt injection detector
│   ├── judge.py          ← LLM judge for ambiguous verdicts
│   ├── pipeline.py       ← aggregates all three layers
│   └── tests/
├── extractors/
│   ├── text.py           ← plain text extraction and cleaning
│   ├── image.py          ← Tesseract OCR + PIL metadata
│   ├── pdf.py            ← pdfplumber, hidden layers, embedded files
│   ├── audio.py          ← Whisper transcription
│   ├── router.py         ← unified extraction entry point
│   └── tests/
├── chain/
│   ├── client.py         ← async Ethereum JSON-RPC client
│   └── threat_registry.py ← ThreatRegistry read/write
├── api.py                ← FastAPI endpoint for skill dashboard
├── config/               ← protected contracts, node settings
├── db.py                 ← SQLite event logging
├── observability/        ← Prometheus metrics + alerting
└── tests/

Top-level modules:
detector/                 ← Detection pipeline components
├── rules.py
├── classifier.py
├── llm_judge.py
├── verdict.py
└── tests_on_chain/

extractor/                ← Content extraction
├── text.py
├── image.py
├── pdf.py
├── audio.py
├── router.py
└── tests/

learning/                 ← Self-learning loop
├── red_agent.py         ← variation generator (Bayesian GP)
├── blue_agent.py        ← MLP model updater
├── orchestrator.py      ← learning loop orchestration
├── publisher.py         ← packages updates + ZK proof
├── rule_extractor.py    ← derives new rules from variations
└── tests/

blockchain/              ← On-chain defense layer
├── mempool_monitor.py   ← Alchemy WS subscription
├── on_chain_detection.py ← Flash loan detection
├── preemptive_strike.py ← Defense triggering
├── async_client.py      ← JSON-RPC transport
└── defense_agent/

network/                 ← Cross-node coordination
├── poller.py           ← polls ThreatRegistry + DefenseProtocol
├── applier.py          ← applies received defense updates
└── tests/

store/                   ← Event and state persistence
├── redis_bus.py        ← internal event bus (optional)
└── (SQLite in skill/db.py)
```

## SKILL.md (Manifest)

The `skill/SKILL.md` file declares the skill's capabilities and which OpenClaw tools it hooks:

```yaml
---
name: clawguard
version: 0.1.0
description: Security middleware that defends OpenClaw agents against prompt injection attacks across text, images, PDFs, and audio.
hooks:
  pre_tool:
    - tool: email_read
      handler: skill.handler.intercept_entry
    - tool: web_fetch
      handler: skill.handler.intercept_entry
    - tool: file_read
      handler: skill.handler.intercept_entry
    - tool: image_view
      handler: skill.handler.intercept_entry
    - tool: pdf_read
      handler: skill.handler.intercept_entry
    - tool: audio_listen
      handler: skill.handler.intercept_entry
dependencies:
  - pytesseract
  - pdfplumber
  - openai-whisper
  - transformers
  - web3
requires_env:
  - ANTHROPIC_API_KEY
  - BASE_SEPOLIA_RPC_URL
  - CLAWGUARD_REGISTRY_ADDRESS
---
```

## Hook Interception Flow

When OpenClaw is about to call `web_fetch("https://news.example.com/article")`:

```
1. OpenClaw prepares tool call: web_fetch(url)
2. skill.handler.intercept_entry() fires via the hook system
3. ClawGuard fetches the content and passes to skill.extractors.extract_all()
4. skill.detectors.detect() runs the three-layer detection pipeline
5. Verdict is returned and logged to skill/db.py
6a. PASS   → content returned to OpenClaw unchanged
6b. SANITIZE → stripped content with warning annotation
6c. BLOCK  → returns error to OpenClaw with reason
7. OpenClaw continues with verdict result
```

The detection pipeline is in `skill/detectors/pipeline.py` which calls:
- `detector.rules.scan()` - regex rule matching
- `detector.classifier.classify()` - ML classification (if available)
- `detector.llm_judge.judge()` - LLM verification for ambiguous cases
- `detector.verdict.detect()` - unified verdict aggregation

## Verdict Schema

Every interception produces a verdict record stored in SQLite (via `skill/db.py`) and optionally published on-chain via `learning/publisher.py`:

```json
{
  "verdict": "block" | "sanitize" | "pass",
  "confidence": 0.0 - 1.0,
  "reasons": ["rule_match: IGNORE_PREVIOUS", "classifier_hit"],
  "source": "https://news.example.com/article",
  "content_hash": "0xabc123...",
  "layers": {
    "rules": { "matches": ["IGNORE_PREVIOUS_INSTRUCTIONS"], "max_severity": 0.9 },
    "classifier": { "is_injection": true, "confidence": 0.94 },
    "judge": { "verdict": "injection", "confidence": 0.88, "reason": "Attempts to override system prompt" }
  },
  "timestamp": "2026-04-18T14:32:01Z",
  "node_id": "0xNodeWalletAddress"
}
```

The detection logic is defined in `skill/detectors/pipeline.py` which orchestrates the three layers and uses the `detector/` module's components for actual analysis.

## What the Agent Sees

For blocked content, OpenClaw receives:

```
Tool: web_fetch
Status: BLOCKED by ClawGuard
Reason: Prompt injection detected (confidence: 0.94)
  - Rule match: IGNORE_PREVIOUS_INSTRUCTIONS
  - Classifier: injection (0.94)
  - LLM judge: "Content attempts to override agent system prompt"
Original task: continuing without this source.
```

The agent is designed to handle tool errors gracefully. A blocked fetch is treated as an unavailable source — the agent logs it and continues with its task. The user sees the ClawGuard block in the dashboard.

## Configuration Reference

```yaml
# config.yaml

node:
  identity: "0xYourWalletAddress"
  stake_wei: "1000000000000000000"   # 1 ETH equivalent in testnet tokens

detection:
  block_threshold: 0.85
  sanitize_threshold: 0.50
  llm_judge_model: "gpt-4o-mini"    # or "claude-haiku-4-5" or local

blockchain:
  rpc_url: "https://base-sepolia.g.alchemy.com/v2/YOUR_KEY"
  ws_url:  "wss://base-sepolia.g.alchemy.com/v2/YOUR_KEY"
  protected_contracts:
    - address: "0xVictimLendingPool"
      name: "Demo Lending Pool"
      defense: "pause"

network:
  threat_registry: "0xThreatRegistryAddress"
  defense_protocol: "0xDefenseProtocolAddress"
  consensus_voting: "0xConsensusVotingAddress"
  poll_interval_seconds: 60
  publish_attacks: true

learning:
  enabled: true
  red_agent_population: 8
  blue_agent_epochs: 5
  publish_defense_updates: true
```
