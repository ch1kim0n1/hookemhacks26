// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/DefenseProtocol.sol";

contract MockVerifierTrue is IVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure override returns (bool) {
        return true;
    }
}

contract DefenseProtocolTest is Test {
    DefenseProtocol internal dp;
    MockVerifierTrue internal policyV;
    MockVerifierTrue internal learnV;
    address internal agent = address(0xA11CE);

    function setUp() public {
        policyV = new MockVerifierTrue();
        learnV = new MockVerifierTrue();
        dp = new DefenseProtocol(address(policyV), address(learnV));
        bytes32 h0 = keccak256("defense v1");
        dp.initialize(h0, agent);
    }

    function test_publishDefenseUpdate_advances_version_and_hash() public {
        bytes32 h1 = keccak256("defense v2");
        bytes32[] memory inputs = new bytes32[](2);
        inputs[0] = dp.currentPolicyHash();
        inputs[1] = h1;
        bytes memory proof = hex"01";

        dp.publishDefenseUpdate(h1, proof, inputs);

        assertEq(dp.policyVersion(), 2);
        assertEq(dp.currentPolicyHash(), h1);
        assertEq(dp.policyHashByVersion(2), h1);
    }

    function test_updatePolicy_alias_matches_publishDefenseUpdate() public {
        bytes32 h2 = keccak256("defense v3");
        bytes32[] memory inputs = new bytes32[](2);
        inputs[0] = dp.currentPolicyHash();
        inputs[1] = h2;
        bytes memory proof = hex"02";

        dp.updatePolicy(h2, proof, inputs);
        assertEq(dp.currentPolicyHash(), h2);
    }
}
