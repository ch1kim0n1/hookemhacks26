// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {RiscZeroMockVerifier} from "risc0-ethereum/test/RiscZeroMockVerifier.sol";
import {Receipt as R0Receipt} from "risc0-ethereum/IRiscZeroVerifier.sol";

import {PolicyVerifier} from "../../src/verifiers/PolicyVerifier.sol";
import {CounterfactualVerifier} from "../../src/verifiers/CounterfactualVerifier.sol";
import {LearningVerifier} from "../../src/verifiers/LearningVerifier.sol";

/// @notice Helpers for constructing mock-verifier-compatible seals in
///         forge tests. The on-chain wrappers reconstruct the guest
///         journal as `abi.encodePacked(publicInputs...)` and call the
///         canonical `IRiscZeroVerifier.verify` with `sha256(journal)`.
///         The mock verifier accepts a seal of the form
///         `SELECTOR || claimDigest`, where `claimDigest =
///         ReceiptClaimLib.ok(imageId, journalDigest).digest()`.
contract MockZKFixture is Test {
    bytes4 internal constant MOCK_SELECTOR = 0xFFFFFFFF;

    bytes32 internal constant POLICY_IMAGE_ID =
        keccak256("test.policy-compliance.image-id");
    bytes32 internal constant COUNTERFACTUAL_IMAGE_ID =
        keccak256("test.counterfactual-correctness.image-id");
    bytes32 internal constant LEARNING_IMAGE_ID =
        keccak256("test.learning-correctness.image-id");

    RiscZeroMockVerifier internal mockZk;
    PolicyVerifier internal policyVerifier;
    CounterfactualVerifier internal counterfactualVerifier;
    LearningVerifier internal learningVerifier;

    function _deployMockZK() internal {
        mockZk = new RiscZeroMockVerifier(MOCK_SELECTOR);
        policyVerifier = new PolicyVerifier(mockZk, POLICY_IMAGE_ID);
        counterfactualVerifier = new CounterfactualVerifier(mockZk, COUNTERFACTUAL_IMAGE_ID);
        learningVerifier = new LearningVerifier(mockZk, LEARNING_IMAGE_ID);
    }

    function _packJournal(bytes32[] memory publicInputs) internal pure returns (bytes memory) {
        bytes memory out;
        for (uint256 i = 0; i < publicInputs.length; i++) {
            out = abi.encodePacked(out, publicInputs[i]);
        }
        return out;
    }

    function _mockSeal(bytes32 imageId, bytes32[] memory publicInputs)
        internal
        view
        returns (bytes memory)
    {
        bytes32 journalDigest = sha256(_packJournal(publicInputs));
        R0Receipt memory r = mockZk.mockProve(imageId, journalDigest);
        return r.seal;
    }

    function _policySeal(bytes32[] memory publicInputs) internal view returns (bytes memory) {
        return _mockSeal(POLICY_IMAGE_ID, publicInputs);
    }

    function _counterfactualSeal(bytes32[] memory publicInputs)
        internal
        view
        returns (bytes memory)
    {
        return _mockSeal(COUNTERFACTUAL_IMAGE_ID, publicInputs);
    }

    function _learningSeal(bytes32[] memory publicInputs) internal view returns (bytes memory) {
        return _mockSeal(LEARNING_IMAGE_ID, publicInputs);
    }
}
