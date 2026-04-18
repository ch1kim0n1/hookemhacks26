// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/ClawGuardRegistry.sol";

contract ClawGuardRegistryTest is Test {
    ClawGuardRegistry internal reg;

    function setUp() public {
        reg = new ClawGuardRegistry();
    }

    function test_publishAttack_setsKnownAndThreat() public {
        bytes32 h = keccak256("malicious payload");
        reg.publishAttack(h, "instruction_override", "redacted sample");
        assertTrue(reg.isKnownAttack(h));
        assertTrue(reg.isThreat(h));
    }

    function test_getAttacksSince_pagination() public {
        bytes32 h0 = keccak256("a");
        bytes32 h1 = keccak256("b");
        reg.publishAttack(h0, "c0", "s0");
        reg.publishAttack(h1, "c1", "s1");

        ClawGuardRegistry.Attack[] memory all = reg.getAttacksSince(0);
        assertEq(all.length, 2);
        assertEq(all[0].patternHash, h0);

        ClawGuardRegistry.Attack[] memory tail = reg.getAttacksSince(1);
        assertEq(tail.length, 1);
        assertEq(tail[0].patternHash, h1);
    }

    function test_getRecentAttacks_ordering() public {
        reg.publishAttack(keccak256("x"), "c", "s");
        ClawGuardRegistry.Attack[] memory one = reg.getRecentAttacks(1);
        assertEq(one.length, 1);
    }
}
