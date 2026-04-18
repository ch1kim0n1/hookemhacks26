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

**Local SQLite** — full event record including content hash, extracted text, verdict, confidence, reasons, timestamp, node ID. Used for local audit trail and training data.

**On-chain ThreatRegistry** — the SHA-256 hash of the attack content and its category. This is the minimal signal that gives every other node in the network instant immunity to the exact same attack.

```python
# Both happen atomically before the learning loop fires
local_store.log_attack(event)
threat_registry.publishAttack(
    content_hash=sha256(event.content),
    category=event.primary_reason   # e.g. "direct_injection", "flash_loan"
)
```

---

## Stage 2: Red Agent — Variation Generation

The red agent's job is to generate adversarial variations of the caught attack. These are paraphrased, obfuscated, or structurally modified versions that preserve the attack intent but change the surface form — exactly the kind of variation an attacker would try next to bypass the rule that just caught them.

**For prompt injection attacks (Pipeline A):**

The red agent uses a Bayesian Gaussian Process optimizer to search the "attack space" — in this case, a parameterized representation of prompt injection patterns:

- Paraphrase dimension: synonym substitution, sentence restructuring
- Obfuscation dimension: zero-width char insertion, base64 encoding, unicode normalization tricks
- Embedding dimension: hiding instruction inside benign-looking content (between sentences, in image metadata, in PDF layers)

For each generation, the red agent produces a population of N variations (default 8), tries each against the current detection model, and observes which ones would have evaded detection. Those evasion points become training targets for the blue agent.

```python
red_agent = RedAgent(
    base_attack=caught_event.content,
    attack_category=caught_event.primary_reason,
    use_bayesian=True
)
variations = red_agent.generate_population(size=8)
```

**For on-chain attacks (Pipeline B):**

The red agent operates in the parameter space of the attack: loan amount, price manipulation factor, timing, contract call sequence. This is the same Bayesian GP optimizer from SENTINEL v2, now feeding results back into a unified learning loop. See `SENTINEL v2 services/learning-loop/src/red-agent.ts` for the implementation.

---

## Stage 3: Blue Agent — Model Update

The blue agent is a multilayer perceptron (5→8→4→1 architecture with manual backprop, He initialization, SGD with momentum, L2 regularization) that trains on the variations produced by the red agent.

**Training loop per caught attack:**

```python
# Build training batch from red agent variations
training_data = []
for variation in variations:
    # Variations that evaded detection → positive training examples (attacks)
    is_evasion = current_model.predict(variation.features) < block_threshold
    training_data.append({
        "x": variation.features,
        "y": 1  # label as attack regardless of whether it evaded
    })

# Add some benign examples from recent clean traffic to prevent overfitting
for clean_event in recent_clean_events[-20:]:
    training_data.append({
        "x": clean_event.features,
        "y": 0
    })

# Train
metrics = blue_agent.fit(training_data, epochs=5, batch_size=8)
# metrics: [{epoch, loss, accuracy, examples}, ...]
```

After training, the blue agent's updated weights replace the current classifier weights for on-chain detection. For content-level detection, the weight delta is computed (new weights minus old weights) and packaged for network propagation. Nodes receiving the delta apply it as a gradient step to their own models — federated learning without a central aggregator.

```python
weight_delta = blue_agent.compute_delta(previous_weights, new_weights)
```

---

## Stage 4: Rule Extractor

The red agent's variations that successfully evaded the rule layer reveal gaps in the current ruleset. The rule extractor analyzes these evasion cases and derives new regex patterns.

**Extraction logic:**

For each variation that evaded the rule layer but was still correctly classified as malicious by the classifier or LLM judge:

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

New rules are added to the local rule layer immediately and included in the network defense update.

---

## Stage 5: Defense Publisher

The defense publisher packages the learning loop outputs into a signed, ZK-attested update and publishes it to the `DefenseProtocol` contract on Base Sepolia.

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

**ZK attestation:** Before publishing, the node runs the `DefenseUpdateCorrectness` RISC Zero guest. This circuit proves: (1) the `source_attack_hash` exists in ThreatRegistry, (2) the model delta was derived from training on that attack's variations, (3) the new rules were derived from the same attack pattern. The Groth16 seal is included in the package. Any node that receives the update verifies the seal before applying it — a malicious node cannot fabricate a "defense update" that actually weakens detection.

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
