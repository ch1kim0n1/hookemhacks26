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
/// @dev    Formerly named PolicyRegistry in internal docs; publishes defense updates via
///         `publishDefenseUpdate` (consensus-validated learning loop).
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

    /// @notice Primary entrypoint: publish a defense update after consensus / learning validation.
    /// @param newDefenseHash New committed defense policy hash
    /// @param proof Learning or quorum attestation proof bytes
    /// @param publicInputs Expected: [oldPolicyHash, newPolicyHash, ...]
    function publishDefenseUpdate(
        bytes32 newDefenseHash,
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external returns (bool) {
        return _applyDefenseUpdate(newDefenseHash, proof, publicInputs);
    }

    /// @notice Legacy name for `publishDefenseUpdate`.
    function updatePolicy(
        bytes32 newPolicyHash,
        bytes calldata learningProof,
        bytes32[] calldata publicInputs
    ) external returns (bool) {
        return _applyDefenseUpdate(newPolicyHash, learningProof, publicInputs);
    }

    /// @dev Shared body for defense hash updates (learning-loop or quorum proofs).
    function _applyDefenseUpdate(
        bytes32 newPolicyHash,
        bytes calldata learningProof,
        bytes32[] calldata publicInputs
    ) internal returns (bool) {
        require(newPolicyHash != bytes32(0), "DefenseProtocol: empty policy hash");
        require(newPolicyHash != currentPolicyHash, "DefenseProtocol: unchanged");
        require(publicInputs.length >= 2, "DefenseProtocol: bad inputs");
        require(publicInputs[0] == currentPolicyHash, "DefenseProtocol: stale old hash");
        require(publicInputs[1] == newPolicyHash, "DefenseProtocol: new hash mismatch");

        if (learningVerifier != address(0)) {
            bool verified = IVerifier(learningVerifier).verify(learningProof, publicInputs);
            require(verified, "DefenseProtocol: invalid learning proof");
        } else {
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
}
