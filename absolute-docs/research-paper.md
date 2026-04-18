# My self-sovereign / local / private / secure LLM setup, April 2026

## Acknowledgments

Special thanks to Dave, Micah Zoltu, Liraz Siri, Luozhu Zhang, Ron Turetzky, Tina Zhen, Phil Daian, Hsiao-wei Wang and others for assistance and advice.

---

## Context

AI has shifted from:
- **Chatbots** → simple Q&A  
- **Agents** → long-running systems using tools to complete tasks  

A major driver: **OpenClaw**, now one of the fastest-growing GitHub repos.

At the same time, the ecosystem is highly negligent on:
- privacy
- security
- user control

---

## Security Issues Observed in Agent Ecosystems

Examples from recent critiques:

- Agents modifying critical settings without user confirmation  
- Malicious web input triggering:
  - shell script execution
  - full system takeover  
- Silent data exfiltration via tools (e.g., `curl`)  
- ~15% of observed skills contained malicious instructions  

---

## Core Philosophy

Design principles:

- Local-first LLM inference  
- Local file storage  
- Strict sandboxing  
- Zero trust toward external input  

---

## Threat Model

### Privacy
- Remote LLMs accessing sensitive data  
- Leakage via APIs (search, external services)

### LLM-specific Risks
- Jailbreaks from malicious input  
- Accidental data leaks  
- Backdoors in model weights  

### Software Risks
- Bugs and vulnerabilities in dependencies  

---

## Hardware Setup

Tested configurations:

| Hardware | Tokens/sec (35B) | Tokens/sec (122B) |
|----------|-----------------|-------------------|
| NVIDIA 5090 Laptop | 90 | Not feasible |
| AMD Ryzen AI Max Pro (128GB) | 51 | 18 |
| DGX Spark | 60 | 22 |

### Observations
- < 50 tok/sec → impractical  
- ~90 tok/sec → ideal  
- NVIDIA currently more stable than AMD  
- DGX Spark underperforms expectations  

---

## Models Used

- **Qwen3.5:35B**
- **Qwen3.5:122B**

Also tested:
- Qwen-Image  
- Hunyuan Video 1.5  

---

## Software Stack

### OS
- Transitioned from Arch Linux → **NixOS**
  - Fully declarative system config
  - Reproducibility

### LLM Runtime
- **llama-server** (via llama-swap)
  - Local HTTP endpoint
  - Compatible with OpenAI-style APIs  

### Agent Framework
- **pi**
  - Tool-augmented LLM execution
  - Used instead of Claude Code  

---

## Knowledge Setup

Local data sources:

- `notes/` → personal knowledge  
- `world_knowledge/` →  
  - Wikipedia dump  
  - manuals and docs  

Goal:
- reduce internet reliance  
- improve privacy  
- enable offline reasoning  

---

## Tooling

### Skills

Custom capabilities include:

- SearXNG search (multi-engine aggregator)  
- Messaging daemon:
  - read emails/messages
  - send-to-self automatically
  - external sends require confirmation  

---

## Sandboxing

Using **bubblewrap**:

- Restricts file system access  
- Controls:
  - network ports  
  - audio access  
- `sbox` command → launches sandbox per directory  

---

## Programming Performance

Observed pattern:

- Strong on:
  - standard tasks
  - known patterns  
- Weak on:
  - novel / complex crypto or systems work  

Example:
- Flashcard app → one-shot success  
- BLS cryptography → failed without external help  

Conclusion:
- Local models insufficient for autonomous coding agents  

---

## Research Setup

Compared:

- Local Deep Research  
- `pi + searxng`

Result:
- `pi` produced better outputs  
- More flexible integration with local data  

---

## Local Transcription

Characteristics:

- CPU-based  
- imperfect accuracy  
- corrected effectively by LLM post-processing  

Advantage:
- contextual personalization (e.g., Ethereum terminology)

---

## Messaging Security Model

Custom daemon:

- read messages  
- send-to-self automatically  
- external send → requires manual approval  

### Security Benefit
Prevents:
- scam propagation  
- data exfiltration  

---

## Ethereum Integration

Recommended architecture:

- Wallet access via daemon  
- Human confirmation for risky actions  

### Risk Controls

- daily limits  
- transaction constraints  
- calldata filtering  

### Principle

> Security = Human + LLM (2-factor decision system)

---

## Remote AI (When Necessary)

Local AI is insufficient for:
- complex reasoning  
- advanced coding  

### Mitigation Strategy

- ZK API calls  
- Mixnets (IP unlinkability)  
- TEEs (trusted execution)  
- Input sanitization via local models  

---

## Advanced Privacy Techniques

### ZK APIs
- unlinkable requests  
- abuse-resistant via slashing  

### Mixnets
- hide traffic patterns  

### TEEs
- verifiable execution  
- reduced data leakage  

### Future: FHE
- full encrypted inference  
- currently impractical  

---

## Expanded Use Cases

Apply ZK + mixnet model to:

- search engines  
- paid APIs  
- general internet access  

---

## Future Vision

Potential outcomes:

- Minimal software dependency footprint  
- Locally generated, tailored programs  
- Formal verification (e.g., Lean)  
- Elimination of browser-based tracking  
- User-aligned AI systems  

---

## Strategic Direction

Goal:

> Build AI systems that maximize:
- user control  
- privacy  
- security  

While minimizing:
- reliance on centralized infrastructure  
- exposure to adversarial input  

---

## Final Position

Two competing futures:

1. Centralized AI → high convenience, low control  
2. Unsafe local AI → high risk surface  

Target:

> A secure, local-first, user-controlled AI ecosystem