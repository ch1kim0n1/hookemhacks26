// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ThreatRegistry
/// @notice Anonymized threat signatures for cross-protocol immunity
///         propagation. Operator-only publish.
contract ThreatRegistry {
    struct Signature {
        bytes32 signatureHash;
        bytes32 defensePrimitive;
        uint16 confidence; // basis points 0-10000
        bytes32 derivationProof;
        uint256 publishedAt;
    }

    mapping(bytes32 => Signature) public signatures;
    bytes32[] public signatureHashes;
    address public operator;

    event SignaturePublished(
        bytes32 indexed signatureHash,
        bytes32 defensePrimitive,
        uint16 confidence
    );

    modifier onlyOperator() {
        require(msg.sender == operator, "ThreatRegistry: not operator");
        _;
    }

    constructor(address _operator) {
        require(_operator != address(0), "ThreatRegistry: zero operator");
        operator = _operator;
    }

    function publish(Signature calldata sig) external onlyOperator {
        require(sig.signatureHash != bytes32(0), "ThreatRegistry: empty hash");
        require(sig.confidence <= 10000, "ThreatRegistry: bad confidence");
        require(signatures[sig.signatureHash].signatureHash == bytes32(0), "ThreatRegistry: exists");

        Signature memory stored = Signature({
            signatureHash: sig.signatureHash,
            defensePrimitive: sig.defensePrimitive,
            confidence: sig.confidence,
            derivationProof: sig.derivationProof,
            publishedAt: block.timestamp
        });
        signatures[sig.signatureHash] = stored;
        signatureHashes.push(sig.signatureHash);

        emit SignaturePublished(sig.signatureHash, sig.defensePrimitive, sig.confidence);
    }

    uint256 public ttlSeconds = 604800; // 7 days default

    function setTtl(uint256 _ttl) external onlyOperator {
        ttlSeconds = _ttl;
    }

    function get(bytes32 signatureHash) external view returns (Signature memory) {
        return signatures[signatureHash];
    }

    function getAll() external view returns (bytes32[] memory) {
        return signatureHashes;
    }

    /// @notice Check if a signature hash is a known, non-expired threat
    function isThreat(bytes32 signatureHash) external view returns (bool) {
        Signature memory sig = signatures[signatureHash];
        if (sig.signatureHash == bytes32(0)) return false;
        if (block.timestamp > sig.publishedAt + ttlSeconds) return false; // expired
        return true;
    }

    /// @notice Check multiple signatures in one call
    function areThreat(bytes32[] calldata hashes) external view returns (bool[] memory) {
        bool[] memory results = new bool[](hashes.length);
        for (uint256 i = 0; i < hashes.length; i++) {
            Signature memory sig = signatures[hashes[i]];
            results[i] = sig.signatureHash != bytes32(0) &&
                         block.timestamp <= sig.publishedAt + ttlSeconds;
        }
        return results;
    }

    /// @notice Count of non-expired signatures
    function activeCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < signatureHashes.length; i++) {
            if (block.timestamp <= signatures[signatureHashes[i]].publishedAt + ttlSeconds) {
                count++;
            }
        }
    }
}
