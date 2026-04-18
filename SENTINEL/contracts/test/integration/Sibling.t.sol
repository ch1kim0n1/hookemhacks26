// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PauseController} from "../../src/PauseController.sol";
import {SiblingLendingPool} from "../../src/SiblingLendingPool.sol";
import {SentinelGuard} from "../../src/SentinelGuard.sol";
import {QuarantineVault} from "../../src/QuarantineVault.sol";

/// @dev Locks down the claim "5 sibling protocols propagate immunity" —
///      the sibling pools must deploy to distinct addresses, must check
///      the shared SentinelGuard, and pausing ONE sibling must not pause
///      the others. Without these three invariants the immunity-map UI
///      is animation theatre.
contract SiblingTest is Test {
    SentinelGuard guard;
    PauseController pauser;
    SiblingLendingPool aave;
    SiblingLendingPool compound;
    SiblingLendingPool curve;

    // Stand-in for the PolicyRegistry — PauseController gates `activate`
    // behind `msg.sender == policyRegistry`, and for this test that's us.
    address constant POLICY_REGISTRY = address(0x1111);

    function setUp() public {
        QuarantineVault vault = new QuarantineVault();
        pauser = new PauseController(POLICY_REGISTRY, address(vault));
        vault.setPauseController(address(pauser));
        guard = new SentinelGuard(address(pauser));
        aave = new SiblingLendingPool(address(guard), "Aave");
        compound = new SiblingLendingPool(address(guard), "Compound");
        curve = new SiblingLendingPool(address(guard), "Curve");
    }

    function test_siblings_deploy_to_distinct_addresses() public {
        assertTrue(address(aave) != address(compound));
        assertTrue(address(compound) != address(curve));
        assertTrue(address(aave) != address(curve));
    }

    function test_siblings_expose_human_readable_names() public {
        assertEq(aave.name(), "Aave");
        assertEq(compound.name(), "Compound");
        assertEq(curve.name(), "Curve");
    }

    function test_all_siblings_initially_allow_calls() public {
        assertTrue(aave.isAllowed(bytes4(keccak256("deposit()"))));
        assertTrue(compound.isAllowed(bytes4(keccak256("deposit()"))));
        assertTrue(curve.isAllowed(bytes4(keccak256("deposit()"))));
    }

    function test_pausing_one_sibling_leaves_others_allowed() public {
        // The PauseController's `activate` is guarded by
        // `msg.sender == policyRegistry` — prank as that address.
        vm.prank(POLICY_REGISTRY);
        pauser.activate(address(aave), PauseController.DefenseType.Pause, keccak256("evt1"));

        assertFalse(aave.isAllowed(bytes4(0x12345678)), "Aave should be paused");
        assertTrue(compound.isAllowed(bytes4(0x12345678)), "Compound must not be paused");
        assertTrue(curve.isAllowed(bytes4(0x12345678)), "Curve must not be paused");
    }
}
