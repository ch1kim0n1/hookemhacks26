# Competitive Landscape & Differentiation

The mentor told you **3 other teams in the same track are doing blockchain
security**. That's a problem if you pitch generically, and an opportunity
if you pitch precisely. This doc gives you the language to make the
distinction crystal clear.

---

## The one-sentence frame

> **They secure the chain. We secure the agents that use the chain.**

Say this if any judge mentions the other teams. It's the fastest reset.

---

## Stack-layer diagram — know where you sit

Draw this on a slide or a whiteboard if a judge asks "how are you
different?"

```
┌──────────────────────────────────────┐
│   Application:  AI agents            │ ← ClawGuard lives here
├──────────────────────────────────────┤
│   Middleware:   Wallets, SDKs        │
├──────────────────────────────────────┤
│   Protocol:     Smart contracts      │ ← Typical "blockchain security" teams
├──────────────────────────────────────┤
│   Consensus:    L1 / L2              │
└──────────────────────────────────────┘
```

You are the *only* team at the top layer. Every other security team is
at least one layer below you. That's not a weakness — it's a category.

---

## Who else plays in this space (and how to handle each)

### The other 3 hackathon teams (likely doing chain-layer security)

| Likely angle | Your counter |
|---|---|
| Smart-contract exploit scanner | "We assume the contracts are fine — we defend the humans and agents *calling* them." |
| Mempool MEV / front-running defense | "Orthogonal. An agent tricked into sending a bad tx is a problem no mempool defense catches." |
| DeFi anomaly detection | "Post-hoc detection. We block at the agent *before* the tx is ever signed." |
| On-chain identity / KYC | "Different problem. A verified identity still sends attacker-controlled instructions to an agent." |

**Universal move:** if you don't know what their angle is, say: *"They're
protecting the chain from bad transactions. We're protecting agents from
bad instructions — which is what causes the bad transactions in the first
place."*

### Real-world competitors (named, in case a judge is sharp)

**Lakera Guard** — closest real competitor.
- *Their pitch:* prompt-injection firewall as a hosted API.
- *Your wedge:* they're text-only, closed, siloed per-customer. You're
  multimodal, open, cross-tenant shared threat registry. Plus, you ship
  as middleware you run locally — their customers don't like sending
  agent traffic through a third-party API.

**Protect AI / Rebuff** — open-source prompt-injection scanner.
- *Their pitch:* a library you import and run.
- *Your wedge:* they're a detection library. You're a deployed system
  with extractors, fail-closed policy, audit log, dashboard, and a
  cross-tenant threat feed. Think *nmap* (them) vs. *Cloudflare WAF*
  (you).

**CrowdStrike / Wiz / Lacework** — enterprise security.
- *Their pitch:* all-in-one security platform.
- *Your wedge:* agent security isn't a priority for them yet — it will
  be. You're either the acquisition target or the starter competitor
  in a market none of them have staffed.

**Anthropic / OpenAI built-in safety** — the obvious "what if they build it."
- *Their pitch:* model-level safety tuning.
- *Your wedge:* model-level safety is defense at layer 7 of a 10-layer
  problem. You need extraction (OCR, PDF, audio), decision logic
  (three-stage), policy controls (block / sanitize / pass), audit,
  sharing. That's an infrastructure problem, not a model problem.
  Cloudflare exists even though AWS has security features.

### Adjacent "blockchain + AI" teams (there's always one)

**Decentralized AI inference (e.g. Gensyn, Ritual)** — running models on-chain.
- *Their pitch:* decentralize the compute.
- *Your wedge:* you're not about *where* inference runs — you're about
  what the agent reads *before* inference. Orthogonal, complementary.

**AI-generated content provenance (e.g. Numbers Protocol)** — signing
AI outputs on-chain.
- *Their pitch:* prove content is AI-generated.
- *Your wedge:* you're not about the output — you're about the
  *input*. They verify what the AI *made*; you verify what the AI
  *read*.

---

## The differentiation table (copy onto a backup slide)

| Dimension | ClawGuard | Chain-layer security teams | Lakera / Rebuff |
|---|---|---|---|
| What's protected | AI agents | Smart contracts / txs | LLM chat apps |
| Scope | Input to agents | On-chain state | Text prompts |
| Modalities | Text, image, PDF, audio | Solidity bytecode | Text only |
| Sharing model | On-chain threat registry | N/A | Per-customer silo |
| Integration | Middleware (3 lines) | External scanner | SDK import |
| Network effect | Yes — shared registry | No | No |
| Demoable today | ✅ Full pipeline live | Varies | ✅ |

---

## The 4 defensibility pillars (memorize)

1. **Network effect** — every attack blocked anywhere protects every
   agent everywhere. This is what made Cloudflare, CrowdStrike, and
   VirusTotal un-dislodgeable.
2. **Multimodal coverage** — we extract from images, PDFs, audio. Most
   competitors are text-only.
3. **Drop-in integration** — 3 lines of code into any OpenClaw /
   LangChain agent. Switching cost goes up fast.
4. **On-chain substrate** — the only neutral place where competing
   security vendors can actually share threat intel.

---

## Hostile question: "Can't someone fork your contract and start a
competing registry?"

> "They can — and if they do, both registries get stronger. The
> network effect compounds to whoever has the most *active publishers*,
> not the most *code*. Forking Bitcoin doesn't give you Bitcoin's
> liquidity. Same dynamic."

---

## Hostile question: "Why won't Cloudflare just build this?"

> "They might. But the 18-month lead matters. Security products win
> on installed base, not features — once you're deployed as middleware,
> ripping out takes a platform migration. We'd rather be the
> incumbent in a small market than a feature in someone else's
> roadmap slide."

---

## The one thing to repeat when pressed

> *"Every other team here is securing **the chain**. We're securing
> **the agents**."*

If you say this three times across the pitch + Q&A, every judge will
remember it. That's the only slogan that needs to survive the day.
