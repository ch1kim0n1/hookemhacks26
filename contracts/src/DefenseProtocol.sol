// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs)
        external
        view
        returns (bool);
}

/// @title DefenseProtocol
/// @notice Authority for what actions the defense agent may take. Every
///         defense tx flows through `verifyAndExecute`, which checks the
///         ZK policy proof, asserts the policy hash in the public inputs
///         matches the current policy, and then `call`s the target with
///         the authorized action.
/// @dev    Storage / events / function signatures per
///         absolute-docs/02_smart_contracts.md §DefenseProtocol.
contract DefenseProtocol {
    // --- Storage ---
    bytes32 public currentPolicyHash;
    uint256 public policyVersion;
    address public policyVerifier;
    address public learningVerifier;
    address public defenseAgent;
    address public owner;
    mapping(uint256 => bytes32) public policyHashByVersion;

    // --- Events ---
    event PolicyInitialized(bytes32 indexed policyHash, uint256 version);
    event PolicyUpdated(
        bytes32 indexed oldHash,
        bytes32 indexed newHash,
        address indexed updater,
        uint256 version
    );
    event ActionExecuted(bytes32 indexed actionHash, address indexed target, bytes4 selector, uint256 blockNumber);
    event ActionRejected(bytes32 indexed actionHash, string reason);

    // --- Modifiers ---
    modifier onlyOwner() {
        require(msg.sender == owner, "DefenseProtocol: not owner");
        _;
    }

    constructor(address _policyVerifier, address _learningVerifier) {
        require(_policyVerifier != address(0), "DefenseProtocol: zero verifier");
        require(_learningVerifier != address(0), "DefenseProtocol: zero learning");
        owner = msg.sender;
        policyVerifier = _policyVerifier;
        learningVerifier = _learningVerifier;
    }

    /// @notice One-time initialization of policy hash + authorized agent.
    function initialize(bytes32 policyHash, address agent) external onlyOwner {
        require(policyVersion == 0, "DefenseProtocol: already initialized");
        require(policyHash != bytes32(0), "DefenseProtocol: empty policy hash");
        require(agent != address(0), "DefenseProtocol: zero agent");
        currentPolicyHash = policyHash;
        policyVersion = 1;
        defenseAgent = agent;
        policyHashByVersion[1] = policyHash;
        emit PolicyInitialized(policyHash, 1);
    }

    /// @notice Verify the ZK policy proof and, on success, execute the
    ///         action against `target`. Public inputs must be
    ///         [actionHash, policyHash, eventId] per doc 04 §PolicyCompliance.
    /// @return success True when the downstream call succeeds.
    function verifyAndExecute(
        address target,
        bytes calldata action,
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external returns (bool success) {
        require(msg.sender == defenseAgent, "DefenseProtocol: not agent");
        require(publicInputs.length >= 3, "DefenseProtocol: bad inputs");

        bytes32 actionHash = publicInputs[0];
        require(publicInputs[1] == currentPolicyHash, "DefenseProtocol: stale policy");
        // publicInputs[2] = eventId — not enforced on-chain (off-chain correlation)

        // Bind the provided calldata to the committed action hash. Prevents
        // a valid proof from authorizing a different action than what's about
        // to execute.
        require(
            keccak256(abi.encodePacked(target, action)) == actionHash,
            "DefenseProtocol: action mismatch"
        );

        bool verified = IVerifier(policyVerifier).verify(proof, publicInputs);
        if (!verified) {
            emit ActionRejected(actionHash, "INVALID_PROOF");
            revert("DefenseProtocol: invalid proof");
        }

        bytes4 selector;
        if (action.length >= 4) {
            selector = bytes4(action[0:4]);
        }

        (success,) = target.call(action);
        if (success) {
            emit ActionExecuted(actionHash, target, selector, block.number);
        } else {
            emit ActionRejected(actionHash, "TARGET_CALL_FAILED");
            revert("DefenseProtocol: target call failed");
        }
    }

    /// @notice Owner-only setter for the learning verifier address.
    ///         Pass address(0) to enable dev-mode proof acceptance.
    function setLearningVerifier(address _verifier) external onlyOwner {
        learningVerifier = _verifier;
    }

    /// @notice Update the policy hash with a proof that the update was earned
    ///         through adversarial training (Red/Blue co-evolution).
    ///         publicInputs = [oldHash, newHash, winRate, eventBatchRoot].
    /// @param newPolicyHash The new policy hash to commit
    /// @param learningProof The LearningLoopCorrectness proof bytes
    /// @param publicInputs Expected: [oldPolicyHash, newPolicyHash, minWinRate, generationCount]
    /// @return true on success
    function updatePolicy(
        bytes32 newPolicyHash,
        bytes calldata learningProof,
        bytes32[] calldata publicInputs
    ) external returns (bool) {
        require(newPolicyHash != bytes32(0), "DefenseProtocol: empty policy hash");
        require(newPolicyHash != currentPolicyHash, "DefenseProtocol: unchanged");
        require(publicInputs.length >= 2, "DefenseProtocol: bad inputs");
        require(publicInputs[0] == currentPolicyHash, "DefenseProtocol: stale old hash");
        require(publicInputs[1] == newPolicyHash, "DefenseProtocol: new hash mismatch");

        if (learningVerifier != address(0)) {
            // Production path: delegate to the real verifier contract.
            bool verified = IVerifier(learningVerifier).verify(learningProof, publicInputs);
            require(verified, "DefenseProtocol: invalid learning proof");
        } else {
            // Dev mode (Phase 4): learningVerifier not set, just require non-empty proof.
            require(learningProof.length > 0, "DefenseProtocol: empty proof");
        }

        bytes32 oldHash = currentPolicyHash;
        uint256 newVersion = policyVersion + 1;
        currentPolicyHash = newPolicyHash;
        policyVersion = newVersion;
        policyHashByVersion[newVersion] = newPolicyHash;

        emit PolicyUpdated(oldHash, newPolicyHash, msg.sender, newVersion);
        return true;
    }

    // ---------------------------------------------------------------
    // ClawGuard defense-update schema
    // ---------------------------------------------------------------

    /// @notice Canonical record of a ClawGuard defense update (new rule set
    ///         and/or new classifier weights), pinned to the attack that
    ///         motivated it. Each record is identified by the
    ///         defense-update-correctness zkProof journal digest.
    struct DefenseUpdate {
        bytes32 ruleDiffHash;           // commit of the rule bundle delta
        bytes32 modelDeltaHash;         // commit of the MLP weight delta
        bytes32 derivedFromAttackHash;  // scan-attestation journal hash that triggered it
        uint256 publishedAt;            // block.timestamp of publishDefenseUpdate
        address publisher;              // operator who submitted the update
    }

    mapping(bytes32 => DefenseUpdate) public defenseUpdates;

    event DefenseUpdatePublished(
        bytes32 indexed updateId,
        bytes32 indexed derivedFromAttackHash,
        bytes32 ruleDiffHash,
        bytes32 modelDeltaHash,
        address indexed publisher
    );

    /// @notice Record a defense-update envelope on-chain after its
    ///         defense-update-correctness zkProof has been verified by
    ///         `learningVerifier`. Off-chain pollers watch the event and
    ///         apply the referenced rule + weight deltas.
    /// @param updateId                Unique id = keccak256 of the seal envelope
    /// @param ruleDiffHash            Commit of the new rule bundle delta
    /// @param modelDeltaHash          Commit of the MLP weight delta
    /// @param derivedFromAttackHash   scan-attestation journal hash that prompted the update
    /// @param zkProof                 defense-update-correctness Groth16 seal bytes
    /// @param publicInputs            [oldPolicyHash, newPolicyHash, attackHash, modelDeltaHash]
    function publishDefenseUpdate(
        bytes32 updateId,
        bytes32 ruleDiffHash,
        bytes32 modelDeltaHash,
        bytes32 derivedFromAttackHash,
        bytes calldata zkProof,
        bytes32[] calldata publicInputs
    ) external returns (bool) {
        require(updateId != bytes32(0), "DefenseProtocol: zero updateId");
        require(defenseUpdates[updateId].publishedAt == 0, "DefenseProtocol: duplicate update");
        require(ruleDiffHash != bytes32(0) || modelDeltaHash != bytes32(0),
            "DefenseProtocol: empty update");
        require(derivedFromAttackHash != bytes32(0), "DefenseProtocol: zero attackHash");
        require(publicInputs.length >= 4, "DefenseProtocol: bad inputs");
        require(publicInputs[2] == derivedFromAttackHash,
            "DefenseProtocol: attackHash mismatch");
        require(publicInputs[3] == modelDeltaHash,
            "DefenseProtocol: modelDeltaHash mismatch");

        if (learningVerifier != address(0)) {
            bool verified = IVerifier(learningVerifier).verify(zkProof, publicInputs);
            require(verified, "DefenseProtocol: invalid update proof");
        } else {
            require(zkProof.length > 0, "DefenseProtocol: empty proof");
        }

        defenseUpdates[updateId] = DefenseUpdate({
            ruleDiffHash: ruleDiffHash,
            modelDeltaHash: modelDeltaHash,
            derivedFromAttackHash: derivedFromAttackHash,
            publishedAt: block.timestamp,
            publisher: msg.sender
        });

        emit DefenseUpdatePublished(
            updateId,
            derivedFromAttackHash,
            ruleDiffHash,
            modelDeltaHash,
            msg.sender
        );
        return true;
    }
}
