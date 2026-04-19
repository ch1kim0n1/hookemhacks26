# Learning loop — honest state

This package contains the **scaffolding** for an adversarial learning loop
(red/blue agents plus a defense-update publisher). It exists to prove out the
interfaces — orchestrator → rule extractor → publisher → on-chain —
not because we have a working attack generator.

## What is real

- `blue_agent.py` — a real from-scratch MLP (He init, SGD + momentum, L2).
  `forward()` / `predict()` work; `fit()` does real backprop.
- `rule_extractor.py` — extracts candidate regex rules from attack variants.
- `publisher.py` — produces an EIP-55 checksummed payload for
  `DefenseProtocol.publishDefenseUpdate` and submits it via web3 when env is
  set. **Now refuses empty ZK proofs** unless `ALLOW_EMPTY_ZK_PROOF=1`
  (dev-only escape hatch).
- `metrics.py` — in-process counters used by the dashboard.
- `orchestrator.py` — glues the above together, emits Prometheus counters,
  fires a Slack alert on `run_round` failure (via `alert_sync`, now
  thread-safe).

## What is a placeholder

- `red_agent.py` — `RedAgent.propose()` returns the seed unchanged. It is
  **not** a Bayesian GP search; it is a one-liner so the rest of the loop has
  inputs to chew on.
- `blue_agent` **features** — `orchestrator.run_round()` passes a hardcoded
  5-vector `[0.2, 0.4, 0.1, 0.0, 0.0]` to the MLP. There is no feature
  extraction from actual detection outcomes yet.
- ZK proof — `publisher.publish_defense_update` is called with a
  `sha256("mock-zk-proof:" + attack_hash)` placeholder. Real proofs require
  `zk/prover_host.py` to be replaced with a production RISC Zero / snarkjs /
  gnark prover. See `zk/INTEGRATION.md`.

## Roadmap

1. Implement feature extraction from `detection_log` rows → 5-vector for MLP.
2. Replace `RedAgent.propose` with a real mutation strategy (Bayesian GP,
   LLM-guided fuzzing, or template-based jitter).
3. Swap the mock ZK prover for the real RISC Zero host and wire
   `DefenseProtocol`'s verifier.
4. Gate `publish_defense_update` behind proof verification in
   `orchestrator.run_round` so bad updates are dropped before an on-chain tx.
