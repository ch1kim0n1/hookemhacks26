# The Story — Problem → Solution → Flowchart → Moat

This is the spine of the pitch. The AWS mentor was explicit: *"Start with
the problem, go to how you're solving it, and how it works (flowchart). Tell
a story."* This document is that story.

---

## 1. The Problem (30 seconds on stage)

**AI agents are now making decisions with real money and real keys, and
they're reading untrusted content to do it.**

- A trading agent reads a Bloomberg email → it can place orders.
- A research agent reads a PDF → it can run code.
- A customer-service agent reads a support ticket → it can refund money.

All of that content is attacker-controllable. **Prompt injection** — where a
string of text hijacks the model's instructions — is **OWASP's #1
vulnerability for LLM applications**. It's not theoretical: Microsoft,
Anthropic, and OpenAI have all shipped patches for real injection CVEs in
the last 18 months.

**The uncomfortable truth:** every company defends its own agents with its
own rules, learns from its own breaches, and never shares what it learns.
There is no CrowdStrike for agents. No shared threat feed. No immune system.

**Why it's urgent (the quantifier):**
- OWASP LLM01 — Prompt Injection — ranked #1 threat since 2023.
- Autonomous-agent products are launching weekly (Claude Computer Use, GPT
  Operators, LangChain agents, crypto trading bots).
- Average cost of a financial agent going rogue for 30 minutes: unbounded.

---

## 2. The Solution (45 seconds on stage)

**ClawGuard is security middleware for AI agents with a shared on-chain
threat registry.**

It does two things:

### (a) Block the attack locally, in real time

Every piece of content an agent reads passes through a three-stage pipeline:

1. **30 regex rules** catch known patterns (instruction overrides, role
   manipulation, hidden system prompts, obfuscation, delimiter abuse). Fast
   and free. If a rule fires with high confidence, we block immediately.
2. **A local ML classifier** (`protectai/deberta-v3-base-prompt-injection-v2`)
   catches semantic variants the rules miss.
3. **A fail-closed LLM judge** (Claude Haiku) resolves ambiguous cases. If
   the API errors, we return `sanitize`, not `pass` — we never silently let
   an attack through.

We also do multimodal extraction — OCR (including inverted/edge-detect
passes for white-on-white text), PDF text-layer parsing, email MIME parsing,
Whisper audio transcription. **This matters because real attacks hide in
images, PDF metadata, and audio** — not just chat messages.

### (b) Share the signature on-chain

The moment ClawGuard blocks a new attack, we hash the malicious payload,
sign it, and publish it to the `ThreatRegistry` smart contract on Base
Sepolia. Every other ClawGuard node polls the registry and caches new
threats locally. **The same attack is then blocked in microseconds
everywhere** — by hash lookup, before the detection pipeline even runs.

This is the "shield that gets stronger as it's attacked" the mentor
described.

---

## 3. The Flowchart (show on a slide)

```
┌──────────────────────────┐
│   Untrusted content      │
│ email / image / PDF /    │
│ audio / HTML             │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  Multimodal extraction   │
│  OCR · PDF · Whisper ·   │
│  MIME · HTML             │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐      hit
│  Hash → Threat cache     │ ────────────► BLOCK (microseconds)
│  (on-chain mirror)       │
└──────────┬───────────────┘
           │ miss
           ▼
┌──────────────────────────┐
│  Detection pipeline      │
│                          │
│  1. Regex rules (30)     │
│  2. ML classifier        │
│  3. LLM judge (fail-     │
│     closed)              │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  Verdict: block /        │
│  sanitize / pass         │
└──────────┬───────────────┘
           │ block or sanitize
           ▼
┌──────────────────────────┐
│  Publish hash →          │
│  ThreatRegistry          │
│  (Base Sepolia)          │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  Every other node picks  │
│  up the signature and    │
│  blocks it instantly.    │
└──────────────────────────┘
```

**On the slide, draw the top-to-bottom flow and highlight the feedback loop
from the registry back to the threat cache.** That loop is the moat.

---

## 4. The Moat (15 seconds on stage)

Most security products get weaker the more customers they have (more noise,
more false positives). **ClawGuard gets stronger.**

Four layers of defensibility:

1. **Network effect.** Every customer attacked makes every other customer
   safer. This is the same dynamic that made Cloudflare, CrowdStrike, and
   VirusTotal uncopyable.
2. **Data moat.** The on-chain threat registry is append-only and
   cross-tenant. A new entrant has to rebuild it from zero.
3. **Integration depth.** ClawGuard ships as a drop-in middleware — 3 lines
   of code in any agent framework. Once integrated, there's no reason to
   rip out.
4. **Multimodal coverage.** Most prompt-injection defenses handle text
   only. We do OCR (with adversarial passes), PDF metadata, audio
   transcription — the surface area everyone else ignores.

---

## 5. The "Who pays us" slide (10 seconds)

**B2B middleware.** We charge per-request to agent platforms and per-seat
for enterprises deploying internal agents.

**Natural acquirers:**
- Agent-framework companies (Anthropic, LangChain, CrewAI).
- AI infra companies (Vercel AI, Replicate, Together).
- Existing security vendors extending to AI (CrowdStrike, Wiz, Lacework).
- Trading and fintech companies running autonomous agents.

The tokenization angle (optional, only mention if asked): the `Consensus`
contract supports staking on threat reports — bad reports get slashed. That
decentralizes the registry without us being a single point of trust.

---

## 6. The close (10 seconds)

**Every AI agent deployed this year is one injection away from a headline.
ClawGuard is how you make sure it isn't yours.**

*Then immediately hand off to the demo.*

---

## Story-telling rules the mentors gave you

| Rule | How we apply it |
|---|---|
| "Start with the problem" | Section 1 — agents with real money + untrusted content |
| "Quantify the problem" | OWASP LLM01, real CVEs in 2023–2024 |
| "Make it niche" | AI agent security middleware (not "AI" or "security" broadly) |
| "Defensibility / nobody else could build a competitor" | Section 4 — network effect + data moat |
| "Talk about the process" | Section 3 — the flowchart |
| "High stakes for the customer" | Agents touch money / keys / code execution |
| "Who's the customer" | Section 5 — B2B middleware, named acquirers |
| "Monetize (tokenization optional)" | B2B SaaS primary, `Consensus` staking optional |
| "Don't lead with crypto" | We lead with *agent security*. Chain is infrastructure, not product. |
