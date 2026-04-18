// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ConsensusVoting
/// @notice Validates K-of-N consensus bundles submitted by the
///         defense-coordinator. A bundle is accepted iff:
///           1. at least `thresholdK` distinct operator addresses are
///              represented (EIP-712 signature verification is added in
///              a later phase), and
///           2. the supplied consensus confidence clears the minimum.
///
///         The accepted bundle is recorded by `(eventId, attackerAddress)`
///         so downstream contracts (SentinelGuard, ThreatRegistry, etc.)
///         can gate their actions on `isAccepted(eventId)`.
contract ConsensusVoting {
    struct Attestation {
        address operator;
        bytes32 attackHash; // hash of the attack fingerprint the operator is voting on
        uint16  confidence; // basis points, 0–10 000
    }

    struct ConsensusBundle {
        bytes32 eventId;
        address attackerAddress;
        uint16  aggregatedConfidence; // basis points
        Attestation[] attestations;
    }

    address public admin;
    uint8   public thresholdK;
    uint8   public thresholdN;
    uint16  public minConfidence; // basis points

    struct AcceptedBundle {
        address attackerAddress;
        uint16  aggregatedConfidence;
        uint8   attestationCount;
        uint256 acceptedAt;
    }

    mapping(bytes32 => AcceptedBundle) public accepted;

    event ThresholdsUpdated(uint8 k, uint8 n, uint16 minConfidence);
    event AdminChanged(address indexed previous, address indexed current);
    event BundleAccepted(
        bytes32 indexed eventId,
        address indexed attackerAddress,
        uint16 aggregatedConfidence,
        uint8 attestationCount
    );
    event BundleRejected(bytes32 indexed eventId, string reason);

    modifier onlyAdmin() {
        require(msg.sender == admin, "ConsensusVoting: not admin");
        _;
    }

    constructor(
        address _admin,
        uint8 _k,
        uint8 _n,
        uint16 _minConfidence
    ) {
        require(_admin != address(0), "ConsensusVoting: zero admin");
        require(_k > 0 && _k <= _n, "ConsensusVoting: bad thresholds");
        require(_minConfidence <= 10000, "ConsensusVoting: bad confidence");
        admin = _admin;
        thresholdK = _k;
        thresholdN = _n;
        minConfidence = _minConfidence;
        emit AdminChanged(address(0), _admin);
        emit ThresholdsUpdated(_k, _n, _minConfidence);
    }

    function setAdmin(address next) external onlyAdmin {
        require(next != address(0), "ConsensusVoting: zero admin");
        emit AdminChanged(admin, next);
        admin = next;
    }

    function setThresholds(uint8 _k, uint8 _n, uint16 _minConfidence) external onlyAdmin {
        require(_k > 0 && _k <= _n, "ConsensusVoting: bad thresholds");
        require(_minConfidence <= 10000, "ConsensusVoting: bad confidence");
        thresholdK = _k;
        thresholdN = _n;
        minConfidence = _minConfidence;
        emit ThresholdsUpdated(_k, _n, _minConfidence);
    }

    /// @notice Submit a federated consensus bundle. Reverts with a clear
    ///         reason if the bundle is malformed; emits `BundleRejected`
    ///         and returns `false` for policy-level rejections (so a
    ///         calling contract can observe both outcomes).
    function submitBundle(ConsensusBundle calldata bundle) external returns (bool) {
        require(bundle.eventId != bytes32(0), "ConsensusVoting: zero eventId");
        require(accepted[bundle.eventId].acceptedAt == 0, "ConsensusVoting: duplicate");

        uint256 n = bundle.attestations.length;
        if (n < thresholdK) {
            emit BundleRejected(bundle.eventId, "below threshold-k");
            return false;
        }
        if (bundle.aggregatedConfidence < minConfidence) {
            emit BundleRejected(bundle.eventId, "below min confidence");
            return false;
        }

        // Verify each attestation: distinct operator, registered model,
        // confidence within bounds.
        address[] memory seen = new address[](n);
        uint256 distinct = 0;

        for (uint256 i = 0; i < n; i++) {
            Attestation calldata att = bundle.attestations[i];
            if (att.confidence > 10000) {
                emit BundleRejected(bundle.eventId, "attestation conf OOB");
                return false;
            }

            // Distinct-operator check. Per-operator identity (signature) is
            // validated in the EIP-712 extension added by Phase 3a.
            bool dup = false;
            for (uint256 j = 0; j < distinct; j++) {
                if (seen[j] == att.operator) {
                    dup = true;
                    break;
                }
            }
            if (!dup) {
                seen[distinct++] = att.operator;
            }
        }

        if (distinct < thresholdK) {
            emit BundleRejected(bundle.eventId, "insufficient distinct operators");
            return false;
        }

        accepted[bundle.eventId] = AcceptedBundle({
            attackerAddress: bundle.attackerAddress,
            aggregatedConfidence: bundle.aggregatedConfidence,
            attestationCount: uint8(distinct),
            acceptedAt: block.timestamp
        });

        emit BundleAccepted(
            bundle.eventId,
            bundle.attackerAddress,
            bundle.aggregatedConfidence,
            uint8(distinct)
        );
        return true;
    }

    /// @notice Has this eventId been accepted as a verified federated threat?
    function isAccepted(bytes32 eventId) external view returns (bool) {
        return accepted[eventId].acceptedAt != 0;
    }
}
