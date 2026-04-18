// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IRiscZeroVerifier} from "risc0-ethereum/IRiscZeroVerifier.sol";

/// @title CounterfactualVerifier
/// @notice Wraps the canonical RISC Zero verifier with a pinned image ID
///         for the CounterfactualCorrectness circuit.
///
///         publicInputs order (5 × bytes32 = 160-byte journal):
///           [0] eventId
///           [1] counterfactualRoot
///           [2] deltaWei
///           [3] victimProtocol (left-padded address)
///           [4] forkBlockHash — Hybrid Approach A: binds the proof to a
///               specific historical block, grounding Timeline B in provable
///               on-chain state without requiring full EVM re-execution.
contract CounterfactualVerifier {
    IRiscZeroVerifier public immutable RISC0_VERIFIER;
    bytes32 public immutable IMAGE_ID;

    /// Journal = 5 × 32-byte slots (160 bytes).
    uint256 private constant EXPECTED_INPUTS = 5;

    constructor(IRiscZeroVerifier _verifier, bytes32 _imageId) {
        require(address(_verifier) != address(0), "CounterfactualVerifier: zero verifier");
        require(_imageId != bytes32(0), "CounterfactualVerifier: zero imageId");
        RISC0_VERIFIER = _verifier;
        IMAGE_ID = _imageId;
    }

    function verify(bytes calldata proof, bytes32[] calldata publicInputs)
        external
        view
        returns (bool)
    {
        if (publicInputs.length != EXPECTED_INPUTS) return false;

        bytes memory journal = abi.encodePacked(
            publicInputs[0],  // eventId
            publicInputs[1],  // counterfactualRoot
            publicInputs[2],  // deltaWei
            publicInputs[3],  // victimProtocol (left-padded)
            publicInputs[4]   // forkBlockHash
        );
        bytes32 journalDigest = sha256(journal);

        try RISC0_VERIFIER.verify(proof, IMAGE_ID, journalDigest) {
            return true;
        } catch {
            return false;
        }
    }
}
