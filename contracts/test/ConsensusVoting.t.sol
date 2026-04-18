// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/ModelRegistry.sol";
import "../src/ConsensusVoting.sol";

contract ConsensusVotingTest is Test {
    ModelRegistry internal reg;
    ConsensusVoting internal cv;
    address internal admin = address(this);
    address internal op1 = address(0x1);
    address internal op2 = address(0x2);
    address internal op3 = address(0x3);

    bytes32 internal mh = keccak256("model");

    function setUp() public {
        reg = new ModelRegistry();
        vm.prank(op1);
        reg.registerModel(mh);
        vm.prank(op2);
        reg.registerModel(mh);
        vm.prank(op3);
        reg.registerModel(mh);

        cv = new ConsensusVoting(address(reg), admin, 2, 3, 5000);
    }

    function test_submitBundle_quorum_accepted() public {
        ConsensusVoting.ConsensusBundle memory bundle;
        bundle.eventId = keccak256("e1");
        bundle.attackerAddress = address(0xBEEF);
        bundle.aggregatedConfidence = 6000;
        bundle.attestations = new ConsensusVoting.Attestation[](2);
        bundle.attestations[0] =
            ConsensusVoting.Attestation({operator: op1, modelHash: mh, confidence: 7000});
        bundle.attestations[1] =
            ConsensusVoting.Attestation({operator: op2, modelHash: mh, confidence: 7000});

        bool ok = cv.submitBundle(bundle);
        assertTrue(ok);
        assertTrue(cv.isAccepted(bundle.eventId));
    }

    function test_slash_blocks_operator_from_bundle() public {
        cv.slash(op1);

        ConsensusVoting.ConsensusBundle memory bundle;
        bundle.eventId = keccak256("e2");
        bundle.attackerAddress = address(0xBEEF);
        bundle.aggregatedConfidence = 6000;
        bundle.attestations = new ConsensusVoting.Attestation[](2);
        bundle.attestations[0] =
            ConsensusVoting.Attestation({operator: op1, modelHash: mh, confidence: 7000});
        bundle.attestations[1] =
            ConsensusVoting.Attestation({operator: op2, modelHash: mh, confidence: 7000});

        bool ok = cv.submitBundle(bundle);
        assertFalse(ok);
        assertFalse(cv.isAccepted(bundle.eventId));
    }
}
