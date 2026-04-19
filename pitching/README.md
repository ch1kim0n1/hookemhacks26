# Pitching — ClawGuard

Everything you need to walk into the judging room and win. These docs are
written for **the current state of the repo** (see `README.md#project-honesty`
in the root) — nothing here asks you to lie about scaffolded subsystems.

## Read in this order

1. **`ONE_LINER.md`** — memorize the 10-word version first. Everything else
   expands from it.
2. **`STORY.md`** — the problem / solution / flowchart / moat narrative. This
   is the spine of the pitch.
3. **`SLIDE_DECK.md`** — slide-by-slide outline you can drop into Keynote /
   Figma / Slides in an hour.
4. **`PITCH_SCRIPT.md`** — a word-for-word, timed 3-minute script. Rehearse
   this on a stopwatch **out loud**.
5. **`DEMO_RUNBOOK.md`** — pre-flight checklist, exact commands, and what to
   do when the wifi dies mid-demo.
6. **`QA_PREP.md`** — the 1-minute Q&A. Contains honest answers for the
   scaffolded parts (learning loop, ZK, red agent) so nothing surprises you.
7. **`JUDGE_ANGLES.md`** — different hooks for the General judge, MLH judge,
   and blockchain-track judge.
8. **`COMPETITIVE.md`** — how to differentiate from the 3 other security
   teams in the same track.

## The one rule

**Never lead with "blockchain."** Lead with **"AI agents are the new attack
surface and they have no immune system."** Blockchain is *how* the immune
system is shared, not *what* we sell.

## Time budget the night before

| Task | Time |
|---|---|
| Memorize one-liner + 3 opening sentences | 15 min |
| Build deck from `SLIDE_DECK.md` (7 slides) | 60 min |
| Rehearse `PITCH_SCRIPT.md` on stopwatch × 5 | 45 min |
| Dry-run `DEMO_RUNBOOK.md` end-to-end × 2 | 40 min |
| Read `QA_PREP.md`, say each answer out loud | 20 min |
| **Total** | **~3 hours** |

## The three things a judge needs to remember after you leave

1. **The problem** — one prompt-injected email can make a trading agent sell
   everything. Prompt injection is OWASP LLM #1.
2. **The moat** — every attack blocked anywhere protects every agent
   everywhere, via an on-chain threat registry. Network effects you can't
   fork.
3. **The name** — ClawGuard. Shield for OpenClaw agents.

If they remember those three, you've done your job.
