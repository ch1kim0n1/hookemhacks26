// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs)
        external
        view
        returns (bool);
}

/// @title PolicyRegistry
/// @notice Authority for what actions the defense agent may take. Every
///         defense tx flows through `verifyAndExecute`, which checks the
///         ZK policy proof, asserts the policy hash in the public inputs
///         matches the current policy, and then `call`s the target with
///         the authorized action.
/// @dev    Storage / events / function signatures per
///         absolute-docs/02_smart_contracts.md §PolicyRegistry.
contract PolicyRegistry {
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
        require(msg.sender == owner, "PolicyRegistry: not owner");
        _;
    }

    constructor(address _policyVerifier, address _learningVerifier) {
        require(_policyVerifier != address(0), "PolicyRegistry: zero verifier");
        require(_learningVerifier != address(0), "PolicyRegistry: zero learning");
        owner = msg.sender;
        policyVerifier = _policyVerifier;
        learningVerifier = _learningVerifier;
    }

    /// @notice One-time initialization of policy hash + authorized agent.
    function initialize(bytes32 policyHash, address agent) external onlyOwner {
        require(policyVersion == 0, "PolicyRegistry: already initialized");
        require(policyHash != bytes32(0), "PolicyRegistry: empty policy hash");
        require(agent != address(0), "PolicyRegistry: zero agent");
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
        require(msg.sender == defenseAgent, "PolicyRegistry: not agent");
        require(publicInputs.length >= 3, "PolicyRegistry: bad inputs");

        bytes32 actionHash = publicInputs[0];
        require(publicInputs[1] == currentPolicyHash, "PolicyRegistry: stale policy");
        // publicInputs[2] = eventId — not enforced on-chain (off-chain correlation)

        // Bind the provided calldata to the committed action hash. Prevents
        // a valid proof from authorizing a different action than what's about
        // to execute.
        require(
            keccak256(abi.encodePacked(target, action)) == actionHash,
            "PolicyRegistry: action mismatch"
        );

        bool verified = IVerifier(policyVerifier).verify(proof, publicInputs);
        if (!verified) {
            emit ActionRejected(actionHash, "INVALID_PROOF");
            revert("PolicyRegistry: invalid proof");
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
            revert("PolicyRegistry: target call failed");
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
        require(newPolicyHash != bytes32(0), "PolicyRegistry: empty policy hash");
        require(newPolicyHash != currentPolicyHash, "PolicyRegistry: unchanged");
        require(publicInputs.length >= 2, "PolicyRegistry: bad inputs");
        require(publicInputs[0] == currentPolicyHash, "PolicyRegistry: stale old hash");
        require(publicInputs[1] == newPolicyHash, "PolicyRegistry: new hash mismatch");

        if (learningVerifier != address(0)) {
            // Production path: delegate to the real verifier contract.
            bool verified = IVerifier(learningVerifier).verify(learningProof, publicInputs);
            require(verified, "PolicyRegistry: invalid learning proof");
        } else {
            // Dev mode (Phase 4): learningVerifier not set, just require non-empty proof.
            require(learningProof.length > 0, "PolicyRegistry: empty proof");
        }

        bytes32 oldHash = currentPolicyHash;
        uint256 newVersion = policyVersion + 1;
        currentPolicyHash = newPolicyHash;
        policyVersion = newVersion;
        policyHashByVersion[newVersion] = newPolicyHash;

        emit PolicyUpdated(oldHash, newPolicyHash, msg.sender, newVersion);
        return true;
    }
}
