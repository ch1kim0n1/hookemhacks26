# Demo Script — 3 Wow Moments (90 seconds)

> **This is the pitch you actually give.** `absolute-docs/12_demo_playbook.md`
> is the exhaustive reference; this file is what the presenter memorises.
>
> Everything not in one of the three moments below is **Q&A material**.
> If a judge asks "how does the learning loop retrain the classifier?" —
> great, answer it. But don't volunteer it. One sentence per moment,
> three moments, done.

---

## The One-Sentence Pitch (0–10s)

> "DeFi loses on the order of billions a year to hacks. SENTINEL stops
> the exploit before the chain finalizes it — then proves, with math on-chain,
> exactly how much money that single block just saved."

(Alternate technical version for a chain-native judge: *"SENTINEL intercepts mempool exploits, stops them before they mine, and Groth16-proves the counterfactual loss."*)

That's the whole thesis. Deliver it while the Mission Control landing
animation settles. Do not expand.

---

## Moment 1 — Dual-Timeline Counterfactual (10–40s)

**What judges see**

- Left panel: the attack transaction pending in the mempool.
- Centre: our detection pipeline lighting up, defense tx mined at
  block N.
- Right panel (appears at T+8s): the counterfactual timeline — the
  same block, replayed without our defense, showing **$10.4M drained
  from the victim pool**.
- A Groth16 seal tile renders under the counterfactual with
  `journal[2] = counterfactualRoot`, `journal[3] = deltaWei`.

**What the presenter says**

> "The attack was paused in the same block it would have landed. The
> panel on the right is not a simulation we're asking you to trust —
> it's an Anvil fork at the pre-attack block, replayed, and committed
> on-chain via a ZK proof. This is a blockchain of what **didn't**
> happen."

**Why this works**

Judges have never seen a counterfactual proof before. The tile with
the Groth16 seal is the image they remember when they're deliberating.

---

## Moment 2 — Fail Closed · Agent on a Crypto Leash (40–60s)

**What judges see**

- A second simulated event: an "operator override" request — an
  instruction telling the agent to pause a protocol that is **not** in
  the threat pattern registry.
- The defense-agent hits `/prove/policy`. The prover returns **422**.
- On-chain: `PolicyVerifier.verify` is never called — the agent
  doesn't transact.
- UI renders the cue inline in red: *"FAIL CLOSED — policy proof
  refused (POLICY_REFUSAL). No tx was sent."*
- The war-room Moment-2 tile (`war-demo-room.ts` DEMO_MOMENTS)
  reinforces the wording: **FAIL CLOSED · AGENT ON A CRYPTO LEASH**.

**What the presenter says**

> "Here I'm trying to make the defense agent do something the policy
> doesn't authorise. The agent can't. Not a timeout, not a fallback —
> the zkVM refuses to produce a proof, and the smart contract refuses
> the action without one. The model, the policy, and the action are
> bound together cryptographically. **The agent is on a crypto leash.**"

**Optional beat — human in the loop (only if a judge asks)**

If you hear "but what if the AI is still wrong even when it's
cryptographically authorised?": the defense-agent supports a
`SENTINEL_REQUIRE_APPROVAL=1` flag. When set, high-confidence defenses
publish `DEFENSE_PENDING_APPROVAL` and block on an operator decision —
the war-room renders a pulsing amber banner with Approve / Reject
buttons and a 90-second fail-closed countdown. It's off by default
(that's the 2.4 ms detection claim), but you can flip it on live and
the demo keeps working end to end.

**Why this works**

This is the answer to every "but what if the AI goes rogue?" question
a judge is thinking about. Show it, don't just claim it. A visible
**failure** demonstrates the safety boundary louder than a thousand
successes.

---

## Moment 3 — Cross-Protocol Immunity (60–85s)

**What judges see**

- `<immunity-map>` fades up: five sibling protocols on a network
  graph.
- The attack signature from Moment 1 propagates as an animated pulse
  from the victim node to all five siblings.
- Caption under each: *"signature received, pattern blocked"* with a
  timestamp delta (typically 40–120ms).
- The attacker's signature is now on the on-chain `ThreatRegistry`.

**What the presenter says**

> "The attacker's signature just propagated to every other protocol in
> the federation. If they retry anywhere — a different lending pool, a
> different chain — they'll be paused **before** the transaction mines.
> The on-chain ThreatRegistry is the immune system's memory."

**Final 10-second beat — learning from the attack (optional)**

As the immunity map settles, the Blue-agent training sparkline animates
in the bottom corner: loss drops from **0.42 → 0.08** over five
synthetic adversarial rounds.

> "Every attack that hits the federation becomes a training sample.
> The signature you just saw propagate is in the next generation's
> training batch. **This is what it looks like when a defense system
> gets stronger every time it's attacked.**"

**Why this works**

This is the "network effect" moment — judges start imagining the
product at scale. It also explains why this is not just a better
monitoring service: it's infrastructure that compounds.

---

## Closer (85–90s)

> "Detection in 2.4 milliseconds. An Ethereum block is 12 seconds —
> we catch the attack five thousand times before it could mine.
> Defense in one block. Proof on-chain. SENTINEL v2 — we built the
> thing that makes DeFi exploits a historical category."

---

## Rules for the Presenter

1. **Three moments, three sentences each. Nothing more.**
2. If a judge interrupts with a question, answer it from Q&A
   material — do **not** restart the script. Pick up from the next
   moment.
3. If any moment fails (WS drops, scenario orchestrator hiccups, a
   service is down): **keep talking**. The frontend has a simulator
   fallback wired into `war-demo-room.ts` that auto-engages after
   10s of WS silence. Moment 1 has a pre-recorded MP4 fallback at
   `assets/demo/moment1-counterfactual.mp4` on the backup laptop.
4. **Never** say "production", "enterprise-ready", "fully decentralised",
   or "AI-powered". Judges have heard every stock phrase ten times
   today. Be specific instead.

## What Got Cut (and why)

These were in earlier versions of the playbook. They were cut
because they didn't survive the "would a judge still be paying
attention?" test:

- **Red/Blue adversarial learning loop** — fascinating, but a 20s
  detour from the defense narrative. Q&A material.
- **K-of-N federation quorum math** — matters for threat model
  deep-dives; doesn't matter for the 90s pitch.
- **Detection engine histogram with p50/p95 latencies** — one
  memorable number ("2.4ms") beats a chart.
- **Proof cache L1/L2 architecture** — genuine engineering, but it
  defends against the question "will this be slow?" which is better
  rebutted by just not being slow.

All of the above are in Q&A at [`docs/judge-qa.md`](judge-qa.md).
