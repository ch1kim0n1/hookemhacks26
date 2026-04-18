// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/DefenseProtocol.sol";
import "../src/mocks/MockGroth16Verifier.sol";

/// @notice On-chain wiring: MockGroth16Verifier satisfies IVerifier for defense updates.
contract MockGroth16DefenseProtocolTest is Test {
    DefenseProtocol internal dp;
    MockGroth16Verifier internal mock;

    function setUp() public {
        mock = new MockGroth16Verifier();
        dp = new DefenseProtocol(address(mock), address(mock));
        bytes32 h0 = keccak256("defense v1");
        dp.initialize(h0, address(0xA11CE));
    }

    function test_publishDefenseUpdate_mockVerifier_accepts() public {
        bytes32 h1 = keccak256("defense v2");
        bytes32[] memory inputs = new bytes32[](2);
        inputs[0] = dp.currentPolicyHash();
        inputs[1] = h1;
        bytes memory proof = hex"01";

        dp.publishDefenseUpdate(h1, proof, inputs);

        assertEq(dp.currentPolicyHash(), h1);
        assertEq(dp.policyVersion(), 2);
    }
}
