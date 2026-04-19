# Q&A Prep — 1 minute

Three judges, one minute total. You'll get 2–4 questions max. These are the
ones to expect, ordered by likelihood.

**Rule 1:** Never lie about scaffolded subsystems. Your repo has a
`Project Honesty` section — a judge who reads it will respect you for it.
A judge who catches you overclaiming will not.

**Rule 2:** Every answer ends with a concrete next sentence. Don't trail
off. Either answer → pivot to a strength, or answer → "happy to go deeper
if useful."

---

## The most likely questions

### Q1. "How is this different from the other 3 teams doing blockchain security?"

> "They're securing the chain — smart-contract exploits, mempool attacks,
> DeFi anomalies. We're securing the *agents that use the chain*. Different
> layer of the stack. An agent with a wallet can drain itself without any
> smart-contract bug — it just needs to be tricked. That's the attack
> surface we own."

### Q2. "Prompt-injection detection is a crowded space — Lakera, Protect AI,
Rebuff. Why you?"

> "Three things. One, we're multimodal — Lakera and Rebuff are text-only;
> we handle OCR, PDFs, and audio, which is where real attacks hide. Two,
> we're shared — they each run siloed per-customer; our on-chain registry
> means one customer's incident defends every other customer. Three, we
> ship as middleware, not an API call — three lines of code into any
> OpenClaw or LangChain agent. Drop-in integration is the wedge."

### Q3. "Why blockchain? Couldn't a database do this?"

> "A shared SQL database would need a central operator everyone trusts.
> Security vendors aren't going to route their threat intel through a
> competitor. A public append-only registry removes the trust requirement
> — anyone can publish, anyone can verify, nobody controls the feed. It's
> the same reason VirusTotal works as a shared resource but a proprietary
> feed wouldn't."

### Q4. "How do you stop someone from spamming fake threats to the registry?"

> "Two layers. First, publishers are signed and rate-limited per address.
> Second, we have a `Consensus` contract that lets nodes stake on threat
> reports — bad reports get slashed. The staking layer isn't in the demo
> today; it's in the contracts directory as the next milestone."

### Q5. "Walk me through what's actually deployed vs. what's a prototype."

*Be honest — this is the question that separates good teams from great
ones. Your `README.md#project-honesty` table is your cheat sheet.*

> "Deployed and working end-to-end: the detection pipeline, the multimodal
> extractors, the threat registry with real web3 writes to Base Sepolia,
> the admin-auth'd audit log, and the cross-node threat propagation you
> just saw.
>
> Scaffolded, labeled as such in our README: the adversarial learning loop
> — the red agent is a stub so we could build the publisher and on-chain
> defense contract around a real pipeline first. And the ZK proof path is
> mocked; the RISC Zero integration is documented in `zk/INTEGRATION.md`
> as the next two weeks of work.
>
> We chose to ship the end-to-end value first and the ML research loop
> second."

### Q6. "What's the business model?"

> "B2B middleware. Per-request pricing for agent platforms (think
> per-1000-tokens-inspected), per-seat for enterprises deploying internal
> agents. Natural acquirers are Anthropic, LangChain, CrewAI on the agent
> side, and CrowdStrike / Wiz on the security side as they extend into AI."

### Q7. "How big is the market?"

> "The TAM we care about is AI agent deployments — autonomous systems
> making decisions with money, code, or PII. Gartner put enterprise
> agent deployments at the top of their 2026 strategic tech trends list,
> and every major AI lab shipped agents this past year — Claude Computer
> Use, OpenAI Operators, Google Jules. Every one of them needs this
> layer. We're sizing it against the IAM/WAF markets — low tens of
> billions — because the shape of the product is similar."

> *(If asked for a specific number and you don't have one: "We're in the
> sizing phase — we'd rather nail the top 100 agent deployments first
> than fight a TAM slide.")*

### Q8. "Who's your first customer?"

> "Fintech trading desks running autonomous agents. High-stakes, high-pain,
> and they already buy security tooling. Second wave is AI infra
> companies who want to offer injection defense as a feature of their
> platform — we license the registry to them."

### Q9. "What if the attacker bypasses your rules?"

> "That's the point of the pipeline. Rules are layer one — fast and free.
> Layer two is a fine-tuned classifier trained on injection datasets.
> Layer three is an LLM judge that fails *closed* — if it errors, we
> sanitize, we don't pass through. And if all three miss something, the
> first customer hit publishes the hash and every other customer is
> protected within seconds. Defense in depth, plus a shared recovery
> mechanism."

### Q10. "Can this be applied outside of finance / crypto?"

> "Yes. The same pipeline defends a customer-service agent from a
> poisoned support ticket, a research agent from a poisoned PDF, a
> coding agent from a poisoned README. Finance is where the stakes are
> highest and budgets are biggest, so we lead there. The middleware is
> domain-agnostic."

### Q11. "What did you build yourselves vs. off-the-shelf?"

> "We built: the middleware architecture, the hash-first on-chain cache,
> the multimodal extractor chain with the inverted/edge-detect OCR
> passes, the three-stage pipeline, the Solidity contracts
> (`ThreatRegistry`, `DefenseProtocol`, `Consensus`), the dashboard, and
> the fail-closed judge logic.
>
> Off-the-shelf: we use the `protectai/deberta-v3` classifier as our ML
> layer — no reason to re-train what's already state of the art —
> Tesseract for OCR, Whisper for audio, and Claude Haiku as the judge
> model. Those are the reliable building blocks."

### Q12. "What would you build next with another month?"

> "Three things, in order: real adversarial feature extraction for the
> learning loop so we auto-generate new rules from past attacks, the
> RISC Zero prover so defense updates are cryptographically attested
> end-to-end, and a LangChain / CrewAI SDK for one-line integration."

---

## Curveball questions (rare but possible)

### "Isn't this just a regex + GPT wrapper?"

> "The naive version is. The value we add is three-stage short-circuiting
> so we're not paying for an LLM call on every request, multimodal
> extraction most wrappers skip, a fail-closed guarantee, and the
> cross-tenant threat registry — which is the part nobody else is
> building."

### "What stops Anthropic from shipping this themselves?"

> "Nothing — and that's good for us. If they build it, they're a
> customer or an acquirer. Cloudflare didn't lose because AWS built CDN
> features; they won because *every* AWS customer *also* used Cloudflare
> for the parts AWS didn't prioritize. Same pattern."

### "How do you handle false positives?"

> "Every verdict has a confidence score and a severity. We give
> operators three responses — block, sanitize (strip the suspicious
> span and pass the rest), or pass. Sanitize lets legit traffic through
> with the attack neutralized. Plus every decision is in an auditable
> log so ops can tune thresholds per deployment."

### "Is the on-chain part actually necessary for the product to work?"

> "No — and we're honest about that. The detection works perfectly
> offline. The chain is the *sharing* layer; it's what turns a
> single-tenant defense into a collective one. That's the moat, but
> it's additive, not load-bearing."

---

## Hard-ball / honesty questions

### "Your README says the adversarial learning loop is a scaffold. Is that a problem?"

> "Not for the current product. The learning loop is how ClawGuard
> *improves over time* — the baseline detection already blocks the
> attacks you just saw. We front-loaded the shared-registry
> infrastructure because that's the harder, more defensible piece;
> the red-agent mutation strategy is well-understood ML work on top.
> Honest roadmap, not a missing foundation."

### "The ZK proofs are mocked?"

> "Correct — `zk/prover_host.py` returns deterministic fake proofs so
> the publisher pipeline can be integration-tested end-to-end. The
> real RISC Zero integration is documented in `zk/INTEGRATION.md`.
> We chose to prove the pipeline works before swapping in the
> expensive part. It's explicitly labeled as mock in the project
> honesty table."

### "Why should I trust you'll finish these?"

> "Two signals. One, we labeled them as scaffolds publicly — teams
> that hide scaffolds don't finish them; teams that document them do.
> Two, the surrounding infrastructure — Alembic migrations, Prometheus
> metrics, CSP headers, admin auth, CI quality gates — is production-
> grade. That's not the output of a team that gives up when the fun
> part is done."

---

## Things to *not* say

- ❌ "We didn't have time to finish X." → Say: "We prioritized Y first."
- ❌ "It's just a hackathon project." → You're pitching a product. Act
  like it.
- ❌ "I'm not sure." → Say: "I don't have that number on hand — happy to
  follow up" and move on.
- ❌ Apologizing. Ever. About anything.

---

## The exit line

Last answer should end with:

> "If any of this lands for you, the repo is at [URL] and the
> `pitching/` folder has our full thesis. Thanks for your time."

Then **stop talking.** Let them ask the next team up.
