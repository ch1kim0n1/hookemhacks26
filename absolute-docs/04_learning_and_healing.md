# Self-Learning and Self-Healing Loop

This is the core of what makes ClawGuard different from every other security tool. When an attack is caught, the system does not just log it and move on. It enters a five-stage loop that generates adversarial variations, trains the detection model against them, extracts new rules, and publishes the updated defense to the network. The network heals itself.

---

## Overview

```
Attack Caught (Pipeline A or B)
          │
          ▼
┌─────────────────────┐
│  Stage 1: Record    │
│  Hash → ThreatReg   │
│  Full event → SQLite│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Stage 2: Red Agent │
│  Generate N         │
│  adversarial        │
│  variations of the  │
│  attack pattern     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Stage 3: Blue Agent│
│  MLP trains on      │
│  variations via     │
│  backprop           │
│  Updated weights    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Stage 4: Rule      │
│  Extractor          │
│  Derive new regex   │
│  rules from         │
│  confirmed patterns │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Stage 5: Publish   │
│  New rules + model  │
│  delta + ZK proof   │
│  → DefenseProtocol  │
│  → Network pulls it │
└─────────────────────┘
```

---

## Stage 1: Record

The caught attack is immediately persisted in two places:

**Local SQLite** — full event record in `skill/db.py` including content hash, extracted text, verdict, confidence, reasons, timestamp, node ID. Used for local audit trail and training data.

**On-chain ThreatRegistry** — the SHA-256 hash of the attack content via `skill/chain/threat_registry.py` -> `blockchain/async_client.py`. This is the minimal signal that gives every other node in the network instant immunity to the exact same attack.

```python
# Both happen atomically before the learning loop fires (learning/orchestrator.py)
local_store.log_attack(event)
threat_registry.publishAttack(
    content_hash=sha256(event.content),
    category=event.primary_reason
)
```

---

## Stage 2: Red Agent — Variation Generation

The red agent's job is to generate adversarial variations of the caught attack. Implemented in `learning/red_agent.py`. These are paraphrased, obfuscated, or structurally modified versions that preserve the attack intent but change the surface form.

**For prompt injection attacks (Pipeline A):**

The red agent uses a Bayesian Gaussian Process optimizer (`learning/bayesian_opt.py`) to search the "attack space":

- Paraphrase dimension: synonym substitution, sentence restructuring
- Obfuscation dimension: zero-width char insertion, base64 encoding
- Embedding dimension: hiding instruction inside benign-looking content

For each generation, the red agent produces a population of N variations (default 8), tries each against the current detection model, and observes which ones would have evaded detection. Those evasion points become training targets for the blue agent.

```python
# From learning/orchestrator.py
red = RedAgent()
proposals = red.propose(seed_prompt, n=8)
variants = [p.variant for p in proposals]
```

**For on-chain attacks (Pipeline B):**

The red agent operates in the parameter space of the attack: loan amount, price manipulation factor, timing, contract call sequence. See `learning/features.py` and `blockchain/on_chain_detection.py` for the attack parameter space.

---

## Stage 3: Blue Agent — Model Update

The blue agent is a multilayer perceptron (5→8→4→1 architecture with manual backprop, He initialization, SGD with momentum, L2 regularization). Implemented in `learning/blue_agent.py`. Trains on the variations produced by the red agent.

**Training loop per caught attack:**

```python
# Build training batch from red agent variations
training_data = []
for variation in variations:
    # Variations that evaded detection → positive training examples (attacks)
    is_evasion = current_model.predict(variation.features) < block_threshold
    training_data.append({
        "x": variation.features,
        "y": 1  # label as attack
    })

# Add some benign examples from recent clean traffic
for clean_event in recent_clean_events[-20:]:
    training_data.append({
        "x": clean_event.features,
        "y": 0
    })

# Train
metrics = blue_agent.fit(training_data, epochs=5, batch_size=8)
```

After training, the blue agent's updated weights are used to update the detector. The weight delta is computed and packaged for network propagation via `learning/publisher.py`. Nodes receiving the delta apply it as a gradient step to their own models — federated learning without a central aggregator.

---

## Stage 4: Rule Extractor

The red agent's variations that successfully evaded the rule layer reveal gaps in the current ruleset. The rule extractor (`learning/rule_extractor.py`) analyzes these evasion cases and derives new regex patterns.

**Extraction logic:**

For each variation that evaded the rule layer but was still correctly classified as malicious:

1. Extract the minimal distinguishing subsequence (the segment that carries the attack intent)
2. Generalize it: replace specific words with character class patterns, handle common obfuscation
3. Validate: the new rule must match the variation AND must not fire on a sample of clean content

```python
new_rules = rule_extractor.derive(
    evasion_examples=evasion_variations,
    clean_sample=recent_clean_events,
    min_precision=0.95   # new rule must have <5% false positive rate
)
```

New rules are added to the local rule layer immediately and included in the network defense update via `learning/publisher.py`.

---

## Stage 5: Defense Publisher

The defense publisher (`learning/publisher.py`) packages the learning loop outputs into a signed, ZK-attested update and publishes it to the `DefenseProtocol` contract on Base Sepolia via `blockchain/async_client.py`.

**Package contents:**

```json
{
  "source_attack_hash": "0xabc...",
  "source_attack_category": "direct_injection",
  "new_rules": [
    { "pattern": "(?i)disregard\\s+all\\s+prior", "category": "direct_override" }
  ],
  "model_weight_delta": {
    "layer": "classifier",
    "delta_bytes": "base64-encoded-gradient-delta",
    "delta_hash": "0xdef..."
  },
  "generation": 42,
  "node_id": "0xNodeWalletAddress",
  "zk_proof": "0x...",     // Groth16 seal from DefenseUpdateCorrectness circuit
  "timestamp": "2026-04-18T14:35:00Z"
}
```

**ZK attestation:** Before publishing, `learning/orchestrator.py` generates the `DefenseUpdateCorrectness` ZK proof. This circuit proves: (1) the `source_attack_hash` exists in ThreatRegistry, (2) the model delta was derived from training on that attack's variations, (3) the new rules were derived from the same attack pattern. Any node that receives the update via `network/applier.py` verifies the ZK seal — a malicious node cannot fabricate a "defense update" that actually weakens detection.

**Consensus before application:** The `ConsensusVoting` contract requires K-of-N nodes to vote on a defense update before it becomes canonical. This prevents a single compromised node from poisoning the network's ruleset. See `05_blockchain_layer.md` for the contract interface.

---

## Network Effect Over Time

```
Generation 1: ClawGuard catches "ignore all previous instructions"
  → 8 variations generated (paraphrased forms)
  → Model updated, 1 new rule added
  → 9 total attack patterns now defended against

Generation 2: A different node catches a novel PDF injection
  → 8 more variations generated
  → Model updated (incorporating variation from Gen 1 too)
  → 3 new rules added (PDF-specific patterns)
  → 17 total attack patterns now defended against

Generation N: The network has processed hundreds of attacks
  → Model has trained on thousands of adversarial variations
  → Rule layer covers the majority of known attack surface
  → Novel attacks only need the classifier + LLM judge
  → The cost of attacking the network keeps rising
```

The key property: the network's detection capability is monotonically non-decreasing. Rules are only added, never removed (unless manually reviewed). Model weights only improve on new attack data. The ThreatRegistry only grows. An attacker who bypassed ClawGuard last month almost certainly cannot bypass it this month.
