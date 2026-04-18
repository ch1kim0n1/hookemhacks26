// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ConsensusVoting
/// @notice Validates K-of-N consensus bundles submitted by the
///         defense-coordinator. A bundle is accepted iff:
///           1. every attestation carries a valid EIP-712 signature by
///              the claimed operator over the (eventId, attackHash,
///              confidence) tuple, and
///           2. at least `thresholdK` distinct operator addresses are
///              represented, and
///           3. the supplied consensus confidence clears the minimum,
///           4. every attestation's attackHash matches the bundle's.
///
///         Accepted bundles are recorded by `eventId`; downstream
///         contracts (SentinelGuard, ThreatRegistry, DefenseProtocol)
///         gate their actions on `isAccepted(eventId)`.
contract ConsensusVoting {
    struct Attestation {
        address operator;
        bytes32 attackHash; // hash of the attack fingerprint the operator is voting on
        uint16  confidence; // basis points, 0–10 000
        bytes   signature;  // EIP-712 signature by `operator` over the attestation tuple
    }

    struct ConsensusBundle {
        bytes32 eventId;
        address attackerAddress;
        bytes32 attackHash;
        uint16  aggregatedConfidence; // basis points
        Attestation[] attestations;
    }

    address public admin;
    uint8   public thresholdK;
    uint8   public thresholdN;
    uint16  public minConfidence; // basis points

    // --- EIP-712 domain separator ---
    bytes32 public immutable DOMAIN_SEPARATOR;

    // keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    bytes32 private constant _DOMAIN_TYPEHASH =
        0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;

    // keccak256("Attestation(bytes32 eventId,bytes32 attackHash,uint16 confidence)")
    bytes32 private constant _ATTESTATION_TYPEHASH =
        keccak256("Attestation(bytes32 eventId,bytes32 attackHash,uint16 confidence)");

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

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH,
                keccak256(bytes("ClawGuardConsensusVoting")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );

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

    /// @notice Return the EIP-712 digest an operator signs to attest to
    ///         an attack classification. Exposed for off-chain signers.
    function attestationDigest(bytes32 eventId, bytes32 attackHash, uint16 confidence)
        public view returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(_ATTESTATION_TYPEHASH, eventId, attackHash, confidence)
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// @notice Submit a federated consensus bundle. Reverts with a clear
    ///         reason if the bundle is malformed; emits `BundleRejected`
    ///         and returns `false` for policy-level rejections (so a
    ///         calling contract can observe both outcomes).
    function submitBundle(ConsensusBundle calldata bundle) external returns (bool) {
        require(bundle.eventId != bytes32(0), "ConsensusVoting: zero eventId");
        require(bundle.attackHash != bytes32(0), "ConsensusVoting: zero attackHash");
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

        address[] memory seen = new address[](n);
        uint256 distinct = 0;

        for (uint256 i = 0; i < n; i++) {
            Attestation calldata att = bundle.attestations[i];
            if (att.confidence > 10000) {
                emit BundleRejected(bundle.eventId, "attestation conf OOB");
                return false;
            }
            if (att.attackHash != bundle.attackHash) {
                emit BundleRejected(bundle.eventId, "attestation hash mismatch");
                return false;
            }

            // EIP-712 signature must recover to the claimed operator.
            bytes32 digest = attestationDigest(bundle.eventId, att.attackHash, att.confidence);
            address recovered = _recoverSigner(digest, att.signature);
            if (recovered == address(0) || recovered != att.operator) {
                emit BundleRejected(bundle.eventId, "bad signature");
                return false;
            }

            // Distinct-operator check.
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
            // forge-lint: disable-next-line(unsafe-typecast)
            attestationCount: uint8(distinct),
            acceptedAt: block.timestamp
        });

        emit BundleAccepted(
            bundle.eventId,
            bundle.attackerAddress,
            bundle.aggregatedConfidence,
            // forge-lint: disable-next-line(unsafe-typecast)
            uint8(distinct)
        );
        return true;
    }

    /// @notice Has this eventId been accepted as a verified federated threat?
    function isAccepted(bytes32 eventId) external view returns (bool) {
        return accepted[eventId].acceptedAt != 0;
    }

    // ---------------------------------------------------------------
    // Internal: compact ecrecover with malleability guard.
    // ---------------------------------------------------------------
    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        // Reject high-S malleable signatures.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
