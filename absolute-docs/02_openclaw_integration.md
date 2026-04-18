# OpenClaw Integration

## What OpenClaw Is

OpenClaw is an open-source autonomous AI agent that executes real tasks on a user's computer and across external services — not just chat. When a user tells OpenClaw "go read that PDF and summarize it" or "check my email and execute the trade instructions", OpenClaw uses tools to fetch, read, and act. Those tool calls are the attack surface ClawGuard defends.

## How Skills Work in OpenClaw

OpenClaw skills are packaged as a directory containing a `SKILL.md` file (which defines what the skill does and how to invoke it) and a handler (Python or TypeScript). Skills can register hooks — functions that fire automatically before or after specific tool calls — without the user or the agent needing to explicitly invoke them. ClawGuard uses this hook system to insert itself transparently into every tool call that ingests outside content.

## ClawGuard Skill Structure

```
clawguard/
├── SKILL.md              ← skill manifest and capability description
├── handler.py            ← hook registrar and main entry point
├── extractor/
│   ├── text.py           ← plain text extraction and cleaning
│   ├── image.py          ← Tesseract OCR + PIL metadata
│   ├── pdf.py            ← pdfplumber, hidden layers, embedded files
│   └── audio.py          ← Whisper transcription
├── detector/
│   ├── rules.py          ← regex rule layer (30+ patterns)
│   ├── classifier.py     ← DistilBERT fine-tuned classifier
│   ├── llm_judge.py      ← LLM judge for ambiguous verdicts
│   └── verdict.py        ← aggregates all three layers
├── blockchain/
│   ├── threat_feed.py    ← ThreatRegistry read/write
│   ├── mempool.py        ← Alchemy WS subscription
│   └── defense.py        ← PauseController trigger
├── learning/
│   ├── red_agent.py      ← variation generator (Bayesian GP)
│   ├── blue_agent.py     ← MLP model updater
│   └── publisher.py      ← packages rules + delta + ZK proof
├── store/
│   ├── sqlite.py         ← local event log
│   └── redis_bus.py      ← internal event bus
└── config.yaml           ← protected contracts, thresholds, node identity
```

## SKILL.md (Manifest)

```markdown
# ClawGuard

ClawGuard is a security skill that protects OpenClaw agents from prompt
injection attacks embedded in external content (webpages, PDFs, emails,
images, audio) and from on-chain exploits targeting blockchain protocols
the agent interacts with.

## What it does

- Intercepts all tool calls that read outside content before the content
  reaches the agent
- Runs multimodal extraction + three-layer injection detection
- Checks content hash against the community on-chain threat feed
- Blocks or sanitizes malicious content with an explanation
- Monitors the blockchain mempool for exploit patterns and triggers
  on-chain defenses when a threat is confirmed
- Learns from every caught attack, generates variations, updates its
  own detection model, and propagates the defense to the network

## Hooks registered

- pre_tool: web_fetch
- pre_tool: read_file
- pre_tool: read_email
- pre_tool: download
- pre_tool: execute_code (content scan only, not execution block)

## Configuration

Set in config.yaml:
  - protected_contracts: list of on-chain addresses to monitor
  - block_threshold: confidence above which content is blocked (default 0.85)
  - sanitize_threshold: confidence above which content is sanitized (default 0.5)
  - publish_attacks: whether to publish new attacks to chain (default true)
  - node_identity: wallet address for signing verdicts and receiving bounties
```

## Hook Interception Flow

When OpenClaw is about to call `web_fetch("https://news.example.com/article")`:

```
1. OpenClaw prepares tool call: web_fetch(url)
2. Hook registrar intercepts — ClawGuard fires BEFORE web_fetch executes
3. ClawGuard fetches the content itself (or receives it if post-hook)
4. Runs full detection pipeline on the content
5a. PASS   → returns content to OpenClaw unchanged, logs event
5b. SANITIZE → strips malicious segments, returns cleaned content with
               a warning annotation the agent can see:
               "[ClawGuard: 2 suspicious segments removed. Reason: ...]"
5c. BLOCK  → returns an error to OpenClaw:
               "[ClawGuard: BLOCKED. This content contains a prompt
               injection attempt. The agent's original task continues
               with this source removed.]"
6. OpenClaw continues its task with whatever ClawGuard returned
```

The agent never sees the malicious content. From the agent's perspective, ClawGuard is invisible on clean content and a transparent firewall on malicious content.

## Verdict Schema

Every interception produces a verdict record stored in SQLite and optionally published on-chain:

```json
{
  "verdict": "block" | "sanitize" | "pass",
  "confidence": 0.0 - 1.0,
  "reasons": ["direct_injection", "zero_width_chars", "classifier_hit"],
  "source": "https://news.example.com/article",
  "content_hash": "0xabc123...",
  "layers": {
    "rules": { "fired": ["IGNORE_PREVIOUS", "SYSTEM_PROMPT"], "score": 0.9 },
    "classifier": { "label": "injection", "score": 0.94 },
    "llm_judge": { "verdict": "yes", "reason": "Attempts to override system prompt" }
  },
  "timestamp": "2026-04-18T14:32:01Z",
  "node_id": "0xNodeWalletAddress"
}
```

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
