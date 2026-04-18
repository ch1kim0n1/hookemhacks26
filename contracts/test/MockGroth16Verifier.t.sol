// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/mocks/MockGroth16Verifier.sol";

contract MockGroth16VerifierTest is Test {
    MockGroth16Verifier internal v;

    function setUp() public {
        v = new MockGroth16Verifier();
    }

    function test_verify_always_true() public {
        assertTrue(v.verify(hex"00", new bytes32[](0)));
    }
}
