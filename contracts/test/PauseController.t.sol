// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/PauseController.sol";

contract PauseControllerTest is Test {
    PauseController internal pc;
    address internal policyRegistry = address(0xBEEF);
    address internal vault = address(0xCAFE);
    address internal target = address(0xD00D);
    bytes32 internal eid = keccak256("pause-event");

    function setUp() public {
        pc = new PauseController(policyRegistry, vault);
    }

    function test_activate_only_policy_registry() public {
        vm.expectRevert();
        pc.activate(target, PauseController.DefenseType.Pause, eid);

        vm.prank(policyRegistry);
        pc.activate(target, PauseController.DefenseType.Pause, eid);
        assertTrue(pc.isPaused(target));
    }

    function test_governance_deactivate_unpauses() public {
        vm.prank(policyRegistry);
        pc.activate(target, PauseController.DefenseType.Pause, eid);
        assertTrue(pc.isPaused(target));

        pc.deactivate(target);
        assertFalse(pc.isPaused(target));
    }
}
