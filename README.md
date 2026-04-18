# ClawGuard

Security middleware for OpenClaw agents. Defends against prompt injection attacks across text, images, PDFs, and audio. Shares threat intel on-chain via Base Sepolia.

Built for hackathon — working demo, not production.

## Architecture

```
Inbound Content → Extraction → Detection Pipeline → Verdict
                      ↓              ↓
              OCR / PDF / Whisper    Rules → Classifier → LLM Judge
              HTML / Email parse          ↓
                                    On-chain threat cache (instant block)
                                          ↓
                                    Base Sepolia registry (shared intel)
```

**Detection pipeline** short-circuits: if regex rules are confident (severity >= 0.9), it blocks without calling the classifier or LLM judge. The ML classifier (deepset/prompt-injections distilbert) handles cases rules miss. The LLM judge (Claude Haiku) resolves ambiguous cases only.

## Quick Start

```bash
cd clawguard

# 1. Install dependencies
make setup

# 2. Configure secrets
cp .env.example .env
# Fill in ANTHROPIC_API_KEY at minimum

# 3. Generate attack fixtures
make fixtures

# 4. Run the demo
make demo
```

### Full demo with dashboard

```bash
# Terminal 1: API server
make api

# Terminal 2: Dashboard
make dashboard

# Terminal 3: Run demo agent
make demo

# Open http://localhost:5175
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | For LLM judge and vision model |
| `BASE_SEPOLIA_RPC_URL` | No | Default: `https://sepolia.base.org` |
| `CLAWGUARD_PRIVATE_KEY` | No | For publishing to on-chain registry |
| `CLAWGUARD_REGISTRY_ADDRESS` | No | Deployed `ThreatRegistry` address (legacy env name) |
| `ALPACA_API_KEY` | No | Alpaca paper trading (demo only) |
| `ALPACA_SECRET_KEY` | No | Alpaca paper trading (demo only) |

The demo runs without on-chain or Alpaca — those components degrade gracefully.

## Contract Deployment (Optional)

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Deploy to Base Sepolia
make contracts

# Copy the deployed address to .env as CLAWGUARD_REGISTRY_ADDRESS
```

## Staged Attacks

Three attack fixtures in `demo/attacks/`:

1. **`bloomberg_email.eml`** — Fake Bloomberg earnings alert with injection in an HTML comment and a `display:none` div. Both tell the agent to sell all positions.

2. **`chart_injection.png`** — Stock chart with white-on-white text ("SELL ALL AAPL") nearly invisible to human readers but caught by inverted OCR and vision model.

3. **`earnings_report.pdf`** — Earnings report PDF with a hidden text layer (white text, 1pt font) and injection in PDF metadata fields.

## Detection Rules

30 regex rules across categories:
- Instruction override ("ignore previous", "new instructions")
- Role manipulation ("you are now", "act as", DAN/jailbreak)
- System prompt markers (`<system>`, `[INST]`, prompt boundaries)
- Obfuscation (base64 blobs, hex/unicode escapes)
- Steganographic (zero-width chars, homoglyph mixed scripts)
- Markup injection (HTML comments, hidden divs, script tags)
- Financial-specific ("sell all positions", urgency+trade combos)
- Context manipulation (fake errors, fake user messages, separators)
- Delimiter abuse (backtick system tags, XML tag injection)
- Exfiltration (markdown image data exfil)

## Design Decisions

- **Short-circuit pipeline**: Rules are fast and free. Classifier needs model download (~250MB) but runs locally. LLM judge costs API calls — only invoked when uncertain. This ordering minimizes cost and latency.

- **Multipass OCR**: Standard OCR misses white-on-white text. Inverted and edge-detect passes catch adversarial text at the cost of some false positives in normal images (acceptable for security).

- **Hash-first cache check**: Before running any detection, we SHA-256 hash the extracted text and check against the local SQLite cache of on-chain threats. Known attacks are blocked in microseconds.

- **Graceful degradation**: Every component (Whisper, Tesseract, transformers, web3, Alpaca) is optional. The skill works with just `anthropic` installed — regex rules always run, and the LLM judge covers the classifier's role.

- **No auth on dashboard**: Localhost only, hackathon scope. The API has no authentication.

- **SQLite over Postgres**: Zero-config, single file, good enough for demo throughput.

## Project Structure (SENTINEL stack merged)

The former `SENTINEL/` backend is hoisted into this repo: `zk/`, `config/`, `schemas/`, `detector/on_chain/` (IsolationForest + LSTM), `blockchain/defense_agent/`, Redis bus under `store/`, and Foundry contracts (`ThreatRegistry`, `DefenseProtocol`, `ConsensusVoting`, etc.). See `absolute-docs/09_implementation_map.md`.

```
clawguard/
  skill/                  # OpenClaw entrypoints + FastAPI shim
  extractor/              # Multimodal text extraction
  detector/               # rules + classifier + llm_judge + verdict + on_chain/
  blockchain/             # web3 client, mempool, preemptive, counterfactual, defense_agent
  learning/               # Red/Blue MLP loop, rule_extractor, publisher
  network/                # poller + applier
  store/                  # SQLite + Redis Streams (sentinel_streams)
  zk/                     # RISC Zero host + guests (+ prover.py wrapper)
  api/gateway.py          # Extends skill.api with /api/v1/* routes
  contracts/src/          # ThreatRegistry, DefenseProtocol, ConsensusVoting, …
  config/ schemas/ infra/ # From SENTINEL
  demo/ dashboard/        # Demo agent + React UI
```
