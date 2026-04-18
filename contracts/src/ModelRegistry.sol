// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ModelRegistry
/// @notice On-chain provenance for detection-engine ML models. Each
///         operator registers the sha256 hash of their trained weights +
///         an optional metadata blob (architecture, seed, feature list).
///         The `FederationVerifier` uses this registry to reject
///         attestations that came from unregistered models.
///
///         One operator address ↔ one current model. Re-registration
///         replaces the record (useful for periodic retrains), and the
///         previous hash can still be looked up by hash for audit.
contract ModelRegistry {
    struct ModelRecord {
        bytes32 modelHash;
        string  operatorId;
        uint256 registeredAt;
        bytes   metadata;
    }

    /// @notice Current model per operator address (what they're using right now).
    mapping(address => ModelRecord) public currentModel;

    /// @notice Reverse index: has this model-hash ever been registered?
    mapping(bytes32 => address) public modelOwner;

    /// @notice All operator addresses that have ever registered.
    address[] public operators;
    mapping(address => bool) private _seenOperator;

    address public admin;

    event ModelRegistered(
        address indexed operator,
        bytes32 indexed modelHash,
        string  operatorId,
        bytes   metadata
    );
    event AdminChanged(address indexed previous, address indexed current);

    modifier onlyAdmin() {
        require(msg.sender == admin, "ModelRegistry: not admin");
        _;
    }

    constructor(address _admin) {
        require(_admin != address(0), "ModelRegistry: zero admin");
        admin = _admin;
        emit AdminChanged(address(0), _admin);
    }

    function setAdmin(address next) external onlyAdmin {
        require(next != address(0), "ModelRegistry: zero admin");
        emit AdminChanged(admin, next);
        admin = next;
    }

    /// @notice Register (or update) the caller's current model.
    /// @dev Anyone can register — an operator is whoever holds a given
    ///      address keypair. Reputation / ACL enforcement lives upstream
    ///      at `FederationVerifier` where attestations are gated by a
    ///      roster. Re-registering with the same hash is a no-op.
    function registerModel(
        string calldata operatorId_,
        bytes32 modelHash_,
        bytes calldata metadata_
    ) external {
        require(bytes(operatorId_).length > 0, "ModelRegistry: empty operatorId");
        require(modelHash_ != bytes32(0), "ModelRegistry: empty hash");
        require(bytes(operatorId_).length <= 32, "ModelRegistry: operatorId too long");

        ModelRecord storage rec = currentModel[msg.sender];

        // No-op if caller is re-registering the same hash.
        if (rec.modelHash == modelHash_) {
            return;
        }

        rec.modelHash = modelHash_;
        rec.operatorId = operatorId_;
        rec.registeredAt = block.timestamp;
        rec.metadata = metadata_;

        modelOwner[modelHash_] = msg.sender;

        if (!_seenOperator[msg.sender]) {
            _seenOperator[msg.sender] = true;
            operators.push(msg.sender);
        }

        emit ModelRegistered(msg.sender, modelHash_, operatorId_, metadata_);
    }

    /// @notice Read the current registration for an operator address.
    function modelOf(address operator)
        external
        view
        returns (
            bytes32 modelHash,
            string memory operatorId,
            uint256 registeredAt,
            bytes memory metadata
        )
    {
        ModelRecord storage rec = currentModel[operator];
        return (rec.modelHash, rec.operatorId, rec.registeredAt, rec.metadata);
    }

    /// @notice Is this model-hash the latest registered hash for anyone?
    function isRegistered(bytes32 modelHash) external view returns (bool) {
        address owner_ = modelOwner[modelHash];
        if (owner_ == address(0)) return false;
        return currentModel[owner_].modelHash == modelHash;
    }

    /// @notice Count of unique operator addresses ever registered.
    function operatorCount() external view returns (uint256) {
        return operators.length;
    }

    /// @notice List of all operator addresses — convenient for off-chain auditors.
    function allOperators() external view returns (address[] memory) {
        return operators;
    }

    /// @notice True iff every supplied hash is currently registered.
    function areAllRegistered(bytes32[] calldata hashes) external view returns (bool) {
        for (uint256 i = 0; i < hashes.length; i++) {
            address owner_ = modelOwner[hashes[i]];
            if (owner_ == address(0)) return false;
            if (currentModel[owner_].modelHash != hashes[i]) return false;
        }
        return true;
    }
}
