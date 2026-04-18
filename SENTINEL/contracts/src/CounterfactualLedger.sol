// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs)
        external
        view
        returns (bool);
}

/// @title CounterfactualLedger
/// @notice Immutable record of counterfactual-simulation proofs. Each
///         entry captures the financial delta between Timeline A (real,
///         with defense) and Timeline B (shadow, without defense) for a
///         single threat event, plus a proof digest.
/// @dev    Matches doc 02 §CounterfactualLedger.
contract CounterfactualLedger {
    struct Entry {
        bytes32 eventId;
        uint256 atBlock;
        int256 deltaWei;
        bytes32 realTxHash;
        bytes32 counterfactualRoot;
        bytes32 proofDigest;
        uint256 recordedAt;
    }

    mapping(bytes32 => Entry) public entries;
    bytes32[] public eventIds;
    address public counterfactualVerifier;
    address public prover;
    address public owner;

    event CounterfactualRecorded(
        bytes32 indexed eventId,
        int256 deltaWei,
        uint256 atBlock,
        bytes32 proofDigest
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "CounterfactualLedger: not owner");
        _;
    }

    constructor(address _counterfactualVerifier, address _prover) {
        require(_counterfactualVerifier != address(0), "CounterfactualLedger: zero verifier");
        require(_prover != address(0), "CounterfactualLedger: zero prover");
        owner = msg.sender;
        counterfactualVerifier = _counterfactualVerifier;
        prover = _prover;
    }

    /// @notice Record a counterfactual entry. publicInputs =
    ///         [eventId, counterfactualRoot, deltaWei (as bytes32), victimProtocol, forkBlockHash]
    ///         matching the 5-slot journal committed by the CounterfactualCorrectness guest.
    function record(
        Entry calldata entry,
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external {
        require(msg.sender == prover, "CounterfactualLedger: not prover");
        require(entry.eventId != bytes32(0), "CounterfactualLedger: empty eventId");
        require(entries[entry.eventId].eventId == bytes32(0), "CounterfactualLedger: already recorded");
        require(publicInputs.length >= 3, "CounterfactualLedger: bad inputs");
        require(publicInputs[0] == entry.eventId, "CounterfactualLedger: eventId mismatch");
        require(publicInputs[1] == entry.counterfactualRoot, "CounterfactualLedger: root mismatch");
        require(int256(uint256(publicInputs[2])) == entry.deltaWei, "CounterfactualLedger: delta mismatch");

        bool verified = IVerifier(counterfactualVerifier).verify(proof, publicInputs);
        require(verified, "CounterfactualLedger: invalid proof");

        Entry memory stored = Entry({
            eventId: entry.eventId,
            atBlock: entry.atBlock,
            deltaWei: entry.deltaWei,
            realTxHash: entry.realTxHash,
            counterfactualRoot: entry.counterfactualRoot,
            proofDigest: entry.proofDigest,
            recordedAt: block.timestamp
        });
        entries[entry.eventId] = stored;
        eventIds.push(entry.eventId);

        emit CounterfactualRecorded(entry.eventId, entry.deltaWei, entry.atBlock, entry.proofDigest);
    }

    function getEntry(bytes32 eventId) external view returns (Entry memory) {
        return entries[eventId];
    }

    function getEntryCount() external view returns (uint256) {
        return eventIds.length;
    }

    function getEntryAt(uint256 index) external view returns (Entry memory) {
        require(index < eventIds.length, "CounterfactualLedger: index out of range");
        return entries[eventIds[index]];
    }
}
