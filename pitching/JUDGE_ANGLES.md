# Judge Angles

You get three judges: **General**, **MLH**, and **Specific (blockchain
track)**. Each one scores differently. Adjust which 2–3 sentences you
emphasize based on who you're pitching.

The core pitch doesn't change. The *framing* does.

---

## The General judge

**What they care about:** Is this a real product? Is the team credible?
Would I pay for this?

**Lead with:** the problem, in a story. Use the Bloomberg email.

**Emphasize:**
- Urgency (agents are shipping *this year*, not someday).
- Business model clarity (B2B middleware, named acquirers).
- Demo fidelity (real attacks, real extraction, real block).

**De-emphasize:**
- Solidity specifics. They don't care about `DefenseProtocol.sol`.
- ZK roadmap. Too deep in the weeds.

**Magic phrases for this judge:**
- "Drop-in middleware — three lines of code."
- "B2B, per-request pricing."
- "Every customer attacked makes every other customer safer."

**Closing line:**
> "This is the Cloudflare layer for AI agents. Whoever owns it wins a
> decade."

---

## The MLH judge

**What they care about:** Technical execution, creativity, "did students
actually build something real?" MLH judges tend to read READMEs and
click around the repo.

**Lead with:** the flowchart. MLH judges love architecture diagrams.

**Emphasize:**
- The three-stage pipeline (rules → classifier → judge).
- Multimodal extraction — especially the white-on-white OCR trick.
- Production-grade infra: Alembic migrations, Prometheus metrics, CSP
  headers, rate limiting, admin auth. **Point this out explicitly** —
  MLH judges notice.
- Honest `Project Honesty` table in the README. Own it.

**De-emphasize:**
- Business model / TAM. They don't grade on this.
- Acquirer lists. Irrelevant.

**Magic phrases for this judge:**
- "Fail-closed LLM judge."
- "Hash-first cache check — microseconds on repeat attacks."
- "30 regex rules across 10 categories, including steganographic
  detection."
- "We documented every subsystem honestly in the README."

**Closing line:**
> "Everything you just saw runs in this repo. Clone it, read the
> honesty table, run `make demo`. It works."

---

## The Specific / Blockchain-track judge

**What they care about:** Did you use the chain meaningfully? Is the
on-chain component load-bearing or cosmetic? Could this have been a
database?

**Lead with:** "Every team here is securing the chain. We secure the
*agents that use* the chain."

**Emphasize:**
- The network-effect argument. A shared registry *has* to be
  decentralized because no security vendor will route intel through a
  competitor.
- Base Sepolia deployment is real — show the BaseScan tx link.
- The `Consensus` contract and staking/slashing plan (even if not live
  yet). Shows you thought about trust.
- Differentiation from the 3 other blockchain-security teams (see
  `COMPETITIVE.md`).

**De-emphasize:**
- The full trading-agent demo narrative. They know what an agent is.
- Acquirer list unless asked.

**Magic phrases for this judge:**
- "Append-only cross-tenant threat registry."
- "Signed publisher addresses, rate-limited per sender."
- "Staking + slashing on threat reports via the Consensus contract."
- "Base Sepolia today, chain-agnostic tomorrow — it's just event log
  infra."

**The sharpest comeback for the 'why not a database' challenge:**
> "VirusTotal-style feeds don't work when the publishers are
> competitors. Nobody routes their CrowdStrike detections through
> Microsoft's database. A public append-only registry is the only
> substrate where security vendors actually *share*. That's why the
> chain is load-bearing, not cosmetic."

**Closing line:**
> "We didn't put this on-chain for the badge. We put it on-chain
> because it's the only substrate where adversaries *and*
> competitors can both participate without trusting us."

---

## Pre-judging: figure out who you're talking to

When a judge approaches, you usually have 5 seconds before you start.

- **Lanyard says "MLH":** MLH angle.
- **Lanyard says the track sponsor name (e.g. Base, AWS, etc.):**
  Specific-track angle.
- **Lanyard says "Judge" or is generic:** General angle.
- **If in doubt:** General angle. It's the safest.

---

## The universal opening (works on all three)

If you only have 5 seconds to hook them before the pitch:

> "This is ClawGuard — security middleware for AI agents, with a
> shared on-chain threat registry. One agent gets attacked, every
> agent learns."

That sentence works for all three judge types and buys you the 30
seconds to get into the Bloomberg story.

---

## If a judge is skeptical / arms-crossed

Don't argue. Pivot to the live demo.

> "Easier to show than explain — let me run an attack."

Nobody stays skeptical through a successful live demo.

---

## If a judge is *too* interested and you're running out of time

Reset the clock with:

> "Happy to go deeper — for the 3 minutes though, let me get to the
> on-chain propagation demo. It's the moat."

Always get to the cross-node propagation demo. It's the single most
memorable moment.
