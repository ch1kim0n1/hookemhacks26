# One-Liners & Hooks

Memorize these in order. The first one is the one you repeat at every
opportunity — intro, demo handoff, Q&A close.

## The 10-word version (memorize)

> **ClawGuard is a shared immune system for AI agents.**

## The 25-word version (opening line)

> **AI agents are being handed credit cards, trading desks, and private keys.
> ClawGuard is the firewall that keeps them from getting tricked — and shares
> every attack on-chain so no agent ever falls for the same trap twice.**

## The 60-second elevator pitch

> Prompt injection is the number-one vulnerability in AI systems — OWASP LLM
> 01. One poisoned email or chart can make an autonomous agent wire money,
> sell stocks, or leak a wallet key.
>
> The problem: every company solves this alone. Every attack is learned once,
> defended once, forgotten. There is no shared immune system.
>
> ClawGuard is security middleware for AI agents. It sits in front of every
> piece of content an agent ingests — text, images, PDFs, audio — and blocks
> injection attempts with a three-stage pipeline: regex rules, a local ML
> classifier, and a fail-closed LLM judge. When it blocks something new, the
> attack signature is published to an on-chain registry on Base Sepolia.
> Every other ClawGuard node instantly picks it up. One agent gets attacked,
> every agent learns.
>
> We're a B2B middleware play. Drop-in for any OpenClaw or LangChain agent.
> Acquisition target for every AI infra company that takes agent safety
> seriously.

## Hooks by audience (pick based on the judge)

| Judge type | Opening hook |
|---|---|
| Blockchain track | "Every team here is securing the chain. We secure the agents that *use* the chain." |
| AWS track / General | "Your next breach won't be a human clicking a link — it'll be your AI agent reading one." |
| MLH / student judge | "Imagine your AI assistant reads an email and immediately wires your money to someone else. That's a real attack. We stop it." |
| Investor / technical | "Prompt injection is OWASP LLM #1 with no dominant vendor. We're building the Cloudflare for agent traffic, with a network-effect moat nobody can fork." |

## Closing line (end of pitch, before Q&A)

> **Every AI agent deployed this year is one injection away from a headline.
> ClawGuard is how you make sure it isn't yours.**

## What to NEVER say

- ❌ "We're a blockchain project." — you're a security product that *uses*
  blockchain.
- ❌ "We're building a crypto platform." — overused, not what you are.
- ❌ "We use AI to detect AI attacks." — technically true, but generic. Say
  "three-stage pipeline: rules, classifier, LLM judge" — it sounds engineered.
- ❌ "It's like X for Y." — unless X is Cloudflare or CrowdStrike, it weakens
  the pitch. Own the category.

## The name check

- **Claw** — OpenClaw (the agent framework you protect).
- **Guard** — what you do.
- Say it twice in the pitch. People forget names fast under time pressure.
