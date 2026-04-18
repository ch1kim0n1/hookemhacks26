# Built for Hook ’Em Hacks — scope checklist

Use this page as the single “what we shipped for the hackathon” handout. **Edit the bracketed lines** with your team’s real timeline and names.

## One-liner

SENTINEL v2 — mempool threat detection, ZK-gated defense, counterfactual ledger, and a 90-second `/demo` that runs end-to-end.

## Shipped in this repo (verify in code)

- [ ] **War Demo Room** (`#/demo`) — three-moment demo sequence, live WS feed, simulation fallback, approval-gate banner.
- [ ] **Detection engine** — IsolationForest + PyTorch LSTM, historical replay bench (`services/detection-engine/bench/`).
- [ ] **ZK prover** — Groth16 guests + cache; `scripts/pre-warm-proofs.sh` for demo cache hits.
- [ ] **Smart contracts** — PolicyRegistry, CounterfactualLedger, ThreatRegistry, PauseController, verifiers (`contracts/`).
- [ ] **Operator story** — signed evidence export (`GET /api/v1/evidence/:eventId/export`), federation + preemptive strike paths.

## What to tell judges if asked “what did you build this weekend?”

- Point at **`#/demo`** and the **scoreboard + counterfactual slab + Groth16 seal** — judge-visible UX.
- Point at **`docs/demo-script-trimmed.md`** — the 90-second script.
- Point at **`bench/`** UI (`#/bench`) and **8/8 historical attacks** in `services/detection-engine/bench/results/`.

## Last 36–48 hours (fill in)

- [ ] *Feature / integration / polish:* …
- [ ] *Bugfix / demo reliability:* …
- [ ] *Docs / pitch:* …
