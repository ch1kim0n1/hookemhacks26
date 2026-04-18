# Network Protocol

## Design Principle

ClawGuard nodes do not talk to each other directly. There is no peer-to-peer gossip layer, no central coordinator, no API server that nodes call. All coordination happens through the blockchain. The contracts on Base Sepolia are the shared state. A node that goes offline for a week comes back online, polls the chain, and catches up on every defense update it missed. No message is ever lost.

This design means: no central point of failure, no trust required between nodes, no infrastructure to maintain beyond each node's local stack.

---

## Node Lifecycle

### 1. Startup

```python
# On ClawGuard skill startup:

# 1. Load config (node identity, protected contracts, thresholds)
config = load_config("config.yaml")

# 2. Pull all known attack hashes from ThreatRegistry
#    and cache them locally for fast lookup
last_synced_index = local_store.get_last_synced_index()
new_hashes = threat_registry.getAttacksSince(last_synced_index)
local_cache.add_attack_hashes(new_hashes)

# 3. Pull the latest validated defense update
latest_update = defense_protocol.getLatestValidated()
if latest_update.generation > local_store.get_applied_generation():
    apply_defense_update(latest_update)

# 4. Register for mempool monitoring on protected contracts
mempool_monitor.subscribe(config.protected_contracts)

# 5. Register OpenClaw hooks
hook_registrar.register_all()

log.info("ClawGuard online", node=config.node_identity,
         attacks_cached=len(new_hashes),
         defense_generation=latest_update.generation)
```

### 2. Steady-State Operation

Every `poll_interval_seconds` (default: 60), the node:

```python
async def poll_loop():
    while True:
        # Check for new attack hashes
        new_attacks = threat_registry.getAttacksSince(
            local_store.get_last_synced_index()
        )
        if new_attacks:
            local_cache.add_attack_hashes(new_attacks)
            local_store.update_last_synced_index(
                local_store.get_last_synced_index() + len(new_attacks)
            )

        # Check for new validated defense updates
        latest = defense_protocol.getLatestValidated()
        if latest.generation > local_store.get_applied_generation():
            apply_defense_update(latest)

        await asyncio.sleep(config.poll_interval_seconds)
```

### 3. Applying a Defense Update

```python
def apply_defense_update(update: DefenseUpdate):
    # 1. Verify the ZK proof (locally, before touching model or rules)
    valid = zk_verifier.verify(
        circuit="DefenseUpdateCorrectness",
        proof=update.zk_proof,
        journal={
            "source_attack_hash": update.sourceAttackHash,
            "rules_hash":         update.rulesHash,
            "model_delta_hash":   update.modelDeltaHash,
        }
    )
    if not valid:
        log.warning("Rejected defense update: invalid ZK proof",
                    generation=update.generation)
        return

    # 2. Fetch the rules package and model delta
    #    (stored as IPFS CIDs or calldata depending on size)
    rules = fetch_rules(update.rulesHash)
    delta = fetch_model_delta(update.modelDeltaHash)

    # 3. Apply new rules to local rule layer
    rule_layer.add_rules(rules)

    # 4. Apply model weight delta
    classifier.apply_delta(delta)

    # 5. Record applied generation
    local_store.set_applied_generation(update.generation)

    log.info("Defense update applied",
             generation=update.generation,
             new_rules=len(rules),
             source_attack=update.sourceAttackHash[:10])
```

---

## Attack Hash Propagation

This is the fastest path — new attack hashes propagate to every node within one poll interval (default 60 seconds) of being published.

```
Node A catches attack at T=0
  → publishAttack(hash) at T=0
  → Node B polls ThreatRegistry at T=60
  → Node B adds hash to local cache at T=60
  → Node B now blocks that exact attack instantly at T=60
```

For known-hash attacks (previously seen exact content), this is zero-latency from the second occurrence. The ThreatRegistry lookup runs before any ML inference.

---

## Defense Update Propagation

Defense updates (new rules + model deltas) follow a slower, consensus-gated path. This is intentional — you want multiple nodes to validate a defense update before the whole network applies it.

```
Node A completes learning loop at T=0
  → publishDefenseUpdate(generation=42) at T=0
  → Node B polls DefenseProtocol, sees unvalidated update at T=60
  → Node B independently verifies ZK proof
  → Node B calls ConsensusVoting.vote(42) at T=60
  → Node C does the same at T=120
  → Quorum reached (K=2 of N=3), update validated at T=120
  → All nodes poll and see validated=true at T≤180
  → All nodes apply the update at T≤180
```

Total propagation time for a defense update: 3–5 poll intervals (3–5 minutes at default settings). This can be tuned down for high-urgency environments.

---

## Model Weight Delta Format

Nodes do not ship full model weights — they ship gradient deltas. This has two benefits: smaller on-chain payload, and it allows each node to maintain a locally personalized model that incorporates both the community updates and its own local traffic.

```python
# Serialization format
{
    "layer": "classifier",              # which model
    "architecture": "distilbert-base",  # for compatibility check
    "delta": {
        "layer_0.weight": [[...], ...], # gradient delta, same shape as weights
        "layer_0.bias":   [...],
        # ... other layers
    },
    "learning_rate": 0.001,             # so receiver applies at same scale
    "source_generation": 42,
    "base_model_hash": "0xabc..."       # hash of the model these deltas apply to
}
```

A node applies a delta with:

```python
def apply_delta(delta):
    # Compatibility check
    assert delta["base_model_hash"] == sha256(current_weights)

    # Apply gradient step
    for layer_name, grad in delta["delta"].items():
        current_weights[layer_name] -= delta["learning_rate"] * grad
```

If a node's local model has diverged too far from the base (model hash mismatch), it pulls a fresh model snapshot instead of applying the delta. Full model snapshots are stored off-chain (IPFS) and their CID is published in the defense update.

---

## Node Identity and Staking

Each node has a wallet address (configured in `config.yaml`). This address is used for:

- Signing defense update publications
- Voting on defense updates in ConsensusVoting
- Receiving x402 bounty payments when reported attacks are confirmed
- Staking ETH to participate in consensus (0.1 ETH on testnet)

Nodes without a stake can still use ClawGuard locally — they just cannot publish defense updates to the network or vote on updates. The stake requirement prevents sybil attacks on the consensus mechanism.

---

## Sybil Resistance

An attacker who controls N fake nodes cannot override the quorum because:
1. Each node must stake real ETH (or testnet ETH in MVP)
2. Each defense update requires a valid ZK proof — fake updates cannot pass verification
3. Slashing penalizes nodes that vote for fraudulent updates

In the MVP (K=2 of N=3), a single attacker controlling 2 of 3 nodes could reach quorum. The production deployment increases N and raises K proportionally. The staking requirement means controlling a majority of nodes requires controlling a majority of staked value.
