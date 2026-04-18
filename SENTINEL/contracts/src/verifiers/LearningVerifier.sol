// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IRiscZeroVerifier} from "risc0-ethereum/IRiscZeroVerifier.sol";

/// @title LearningVerifier
/// @notice Wraps the canonical RISC Zero verifier with a pinned image ID
///         for the LearningLoopCorrectness circuit.
///
///         publicInputs order: [oldPolicyHash, newPolicyHash, winRateBp
///         (uint256), generationCount (uint256)]. Journal bytes =
///         abi.encodePacked of those four = 128 bytes.
contract LearningVerifier {
    IRiscZeroVerifier public immutable RISC0_VERIFIER;
    bytes32 public immutable IMAGE_ID;

    uint256 private constant EXPECTED_INPUTS = 4;

    constructor(IRiscZeroVerifier _verifier, bytes32 _imageId) {
        require(address(_verifier) != address(0), "LearningVerifier: zero verifier");
        require(_imageId != bytes32(0), "LearningVerifier: zero imageId");
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
            publicInputs[0],
            publicInputs[1],
            publicInputs[2],
            publicInputs[3]
        );
        bytes32 journalDigest = sha256(journal);

        try RISC0_VERIFIER.verify(proof, IMAGE_ID, journalDigest) {
            return true;
        } catch {
            return false;
        }
    }
}
