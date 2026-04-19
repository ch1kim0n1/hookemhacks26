# Blockchain Layer

## Chain

**Base Sepolia testnet** (chainId: 84532). Chosen for: 2-second block times, low fees, familiar tooling for judges, and good Alchemy WebSocket support for mempool monitoring. Production deployment targets Base mainnet.

The network is coordinated entirely through these contracts deployed on Base Sepolia. All contracts are in `contracts/src/`. Node clients are in `blockchain/` and `skill/chain/`.

Access patterns:
- ThreatRegistry lookup: `skill/chain/threat_registry.py` -> `blockchain/async_client.py`
- Defense updates: `learning/publisher.py` -> `blockchain/async_client.py`
- Network polling: `network/poller.py` -> `blockchain/async_client.py`
- Defense application: `network/applier.py` with ZK verification

---

## Contract Overview

```
┌─────────────────────┐   publishAttack()     ┌──────────────────────┐
│   ClawGuard Node    │──────────────────────▶│   ThreatRegistry     │
│   (any instance)    │   isKnownAttack()      │   (shared memory)    │
└─────────────────────┘◀──────────────────────└──────────────────────┘
          │
          │ publishDefenseUpdate()
          ▼
┌─────────────────────┐   submitVote()        ┌──────────────────────┐
│  DefenseProtocol    │◀──────────────────────│  ConsensusVoting     │
│  (update registry)  │   executeIfQuorum()   │  (K-of-N validation) │
└─────────────────────┘                        └──────────────────────┘
          │
          │ getLatestRules()
          │ getModelDelta()
          ▼
┌─────────────────────┐
│  All Other Nodes    │
│  (poll & apply)     │
└─────────────────────┘

(Separately, for on-chain defense:)
┌─────────────────────┐   verifyAndExecute()  ┌──────────────────────┐
│  Defense Agent      │──────────────────────▶│  PolicyRegistry      │
└─────────────────────┘                        └──────────────────────┘
                                                         │ pause()
                                                         ▼
                                               ┌──────────────────────┐
                                               │  PauseController     │
                                               │  (target protocol)   │
                                               └──────────────────────┘
```

---

## ThreatRegistry.sol

The shared immune memory of the network. Stores hashes of known attacks with their category. Any node can publish; any node can query.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ThreatRegistry {
    struct Attack {
        bytes32 contentHash;
        string  category;       // "direct_injection", "pdf_hidden_layer", "flash_loan", etc.
        address reporter;
        uint256 reportedAt;
        uint256 confirmations;  // votes from other nodes confirming this is real
    }

    mapping(bytes32 => Attack) public attacks;
    bytes32[] public attackIndex;

    event AttackPublished(bytes32 indexed contentHash, string category, address reporter);
    event AttackConfirmed(bytes32 indexed contentHash, address confirmer);

    // Any node can publish. No permission required — deduplication is cheap.
    function publishAttack(bytes32 contentHash, string calldata category) external {
        if (attacks[contentHash].reportedAt == 0) {
            attacks[contentHash] = Attack({
                contentHash:  contentHash,
                category:     category,
                reporter:     msg.sender,
                reportedAt:   block.timestamp,
                confirmations: 1
            });
            attackIndex.push(contentHash);
            emit AttackPublished(contentHash, category, msg.sender);
        } else {
            // Already known — increment confirmation count
            attacks[contentHash].confirmations++;
            emit AttackConfirmed(contentHash, msg.sender);
        }
    }

    function isKnownAttack(bytes32 contentHash) external view returns (bool) {
        return attacks[contentHash].reportedAt > 0;
    }

    function getAttackCount() external view returns (uint256) {
        return attackIndex.length;
    }

    // Paginated fetch for nodes polling new attacks
    function getAttacksSince(uint256 fromIndex) external view
        returns (bytes32[] memory hashes, string[] memory categories)
    {
        uint256 count = attackIndex.length - fromIndex;
        hashes     = new bytes32[](count);
        categories = new string[](count);
        for (uint256 i = 0; i < count; i++) {
            bytes32 h = attackIndex[fromIndex + i];
            hashes[i]     = h;
            categories[i] = attacks[h].category;
        }
    }
}
```

---

## DefenseProtocol.sol

Stores validated defense updates (new rules + model weight deltas). Nodes poll this contract to receive the latest defense package from the network.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DefenseProtocol {
    struct DefenseUpdate {
        uint256 generation;
        bytes32 sourceAttackHash;  // must exist in ThreatRegistry
        bytes32 rulesHash;         // sha256 of the new rules JSON
        bytes32 modelDeltaHash;    // sha256 of the model weight delta
        bytes   zkProof;           // Groth16 seal from DefenseUpdateCorrectness
        address publisher;
        uint256 publishedAt;
        bool    validated;         // set to true after ConsensusVoting quorum
    }

    mapping(uint256 => DefenseUpdate) public updates;
    uint256 public latestGeneration;

    event DefenseUpdatePublished(uint256 indexed generation, address publisher);
    event DefenseUpdateValidated(uint256 indexed generation);

    // Only ConsensusVoting contract can validate
    address public immutable consensusVoting;

    constructor(address _consensusVoting) {
        consensusVoting = _consensusVoting;
    }

    function publishUpdate(
        uint256 generation,
        bytes32 sourceAttackHash,
        bytes32 rulesHash,
        bytes32 modelDeltaHash,
        bytes calldata zkProof
    ) external {
        updates[generation] = DefenseUpdate({
            generation:       generation,
            sourceAttackHash: sourceAttackHash,
            rulesHash:        rulesHash,
            modelDeltaHash:   modelDeltaHash,
            zkProof:          zkProof,
            publisher:        msg.sender,
            publishedAt:      block.timestamp,
            validated:        false
        });
        emit DefenseUpdatePublished(generation, msg.sender);
    }

    function validateUpdate(uint256 generation) external {
        require(msg.sender == consensusVoting, "only consensus contract");
        updates[generation].validated = true;
        if (generation > latestGeneration) latestGeneration = generation;
        emit DefenseUpdateValidated(generation);
    }

    function getLatestValidated() external view returns (DefenseUpdate memory) {
        return updates[latestGeneration];
    }
}
```

---

## ConsensusVoting.sol

K-of-N quorum validation for defense updates. Prevents a single malicious node from poisoning the network's defense rules. Also handles node staking and slashing.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ConsensusVoting {
    uint256 public constant QUORUM_THRESHOLD = 2; // K of N (K=2, N=3 in MVP)
    uint256 public constant STAKE_REQUIRED   = 0.1 ether;

    mapping(address => uint256) public stakes;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => uint256) public voteCount;

    DefenseProtocol public defenseProtocol;

    event NodeStaked(address node, uint256 amount);
    event VoteCast(uint256 generation, address voter);
    event QuorumReached(uint256 generation);
    event NodeSlashed(address node, uint256 amount, string reason);

    constructor(address _defenseProtocol) {
        defenseProtocol = DefenseProtocol(_defenseProtocol);
    }

    function stake() external payable {
        require(msg.value >= STAKE_REQUIRED, "insufficient stake");
        stakes[msg.sender] += msg.value;
        emit NodeStaked(msg.sender, msg.value);
    }

    function vote(uint256 generation) external {
        require(stakes[msg.sender] >= STAKE_REQUIRED, "not a staked node");
        require(!hasVoted[generation][msg.sender], "already voted");

        hasVoted[generation][msg.sender] = true;
        voteCount[generation]++;
        emit VoteCast(generation, msg.sender);

        if (voteCount[generation] >= QUORUM_THRESHOLD) {
            defenseProtocol.validateUpdate(generation);
            emit QuorumReached(generation);
        }
    }

    // Governance: slash a node that published a fraudulent update
    // In production this would be triggered by a separate dispute process
    function slash(address node, string calldata reason) external {
        // MVP: owner-controlled. Production: governed by token holders.
        uint256 amount = stakes[node];
        stakes[node] = 0;
        // slashed stake goes to treasury or burned
        emit NodeSlashed(node, amount, reason);
    }
}
```

---

## x402 Bounty Integration

When a node publishes a new attack hash to ThreatRegistry and that hash subsequently receives QUORUM_THRESHOLD confirmations from other nodes (meaning the network agrees it's a real attack), the reporter receives an x402 micro-payment.

```solidity
// Added to ThreatRegistry.publishAttack()
if (attacks[contentHash].confirmations == BOUNTY_THRESHOLD) {
    x402.pay(attacks[contentHash].reporter, BOUNTY_AMOUNT);
    emit BountyPaid(contentHash, attacks[contentHash].reporter, BOUNTY_AMOUNT);
}
```

This creates the financial incentive for nodes to contribute to the shared threat feed rather than keeping discoveries local.

---

## Deployment

```bash
# Deploy all contracts
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --broadcast \
  --verify

# Outputs addresses to config/addresses.json
# {
#   "ThreatRegistry": "0x...",
#   "DefenseProtocol": "0x...",
#   "ConsensusVoting": "0x...",
#   "PolicyRegistry": "0x...",
#   "PauseController": "0x...",
#   "VictimLendingPool": "0x..."
# }
```
