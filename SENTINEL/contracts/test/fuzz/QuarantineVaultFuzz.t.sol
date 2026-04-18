// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {QuarantineVault} from "../../src/QuarantineVault.sol";

/// @notice Minimal ERC20 used by fuzz tests.
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract QuarantineVaultFuzzTest is Test {
    QuarantineVault vault;
    MockERC20 token;
    address constant CONTROLLER = address(0xC0);
    address constant ORIGIN = address(0x0ABC);

    function setUp() public {
        vault = new QuarantineVault();
        vault.setPauseController(CONTROLLER);
        token = new MockERC20();
    }

    // ---------------------------------------------------------------
    // Fuzz: deposit succeeds with any non-zero amount + valid event
    // ---------------------------------------------------------------

    function testFuzz_Deposit_SucceedsWithValidInputs(
        bytes32 eventId,
        uint96 amount
    ) public {
        vm.assume(eventId != bytes32(0));
        vm.assume(amount > 0);

        token.mint(CONTROLLER, amount);
        vm.prank(CONTROLLER);
        token.approve(address(vault), amount);

        vm.prank(CONTROLLER);
        vault.deposit(eventId, address(token), amount, ORIGIN);

        (address origin, uint256 storedAmount, address storedToken, uint256 releaseTime, bool released) =
            vault.quarantines(eventId);
        assertEq(origin, ORIGIN);
        assertEq(storedAmount, amount);
        assertEq(storedToken, address(token));
        assertEq(releaseTime, block.timestamp + 72 hours);
        assertFalse(released);
    }

    // ---------------------------------------------------------------
    // Fuzz: release respects the 72h delay
    // ---------------------------------------------------------------

    function testFuzz_Release_RevertsBefore72Hours(
        bytes32 eventId,
        uint96 amount,
        uint256 warpSeconds
    ) public {
        vm.assume(eventId != bytes32(0));
        vm.assume(amount > 0);
        warpSeconds = bound(warpSeconds, 0, 72 hours - 1);

        token.mint(CONTROLLER, amount);
        vm.prank(CONTROLLER);
        token.approve(address(vault), amount);
        vm.prank(CONTROLLER);
        vault.deposit(eventId, address(token), amount, ORIGIN);

        vm.warp(block.timestamp + warpSeconds);
        vm.expectRevert(bytes("QuarantineVault: too early"));
        vault.release(eventId);
    }

    function testFuzz_Release_SucceedsAtOrAfter72Hours(
        bytes32 eventId,
        uint96 amount,
        uint256 extraSeconds
    ) public {
        vm.assume(eventId != bytes32(0));
        vm.assume(amount > 0);
        extraSeconds = bound(extraSeconds, 0, 365 days);

        token.mint(CONTROLLER, amount);
        vm.prank(CONTROLLER);
        token.approve(address(vault), amount);
        vm.prank(CONTROLLER);
        vault.deposit(eventId, address(token), amount, ORIGIN);

        vm.warp(block.timestamp + 72 hours + extraSeconds);
        vault.release(eventId);

        // Funds are now with the origin protocol
        assertEq(token.balanceOf(ORIGIN), amount);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    // ---------------------------------------------------------------
    // Fuzz: double-release always reverts
    // ---------------------------------------------------------------

    function testFuzz_Release_DoubleReleaseReverts(
        bytes32 eventId,
        uint96 amount
    ) public {
        vm.assume(eventId != bytes32(0));
        vm.assume(amount > 0);

        token.mint(CONTROLLER, amount);
        vm.prank(CONTROLLER);
        token.approve(address(vault), amount);
        vm.prank(CONTROLLER);
        vault.deposit(eventId, address(token), amount, ORIGIN);

        vm.warp(block.timestamp + 72 hours);
        vault.release(eventId);
        vm.expectRevert(bytes("QuarantineVault: already released"));
        vault.release(eventId);
    }

    // ---------------------------------------------------------------
    // Fuzz: deposit from non-controller always reverts
    // ---------------------------------------------------------------

    function testFuzz_Deposit_OnlyController(
        address attacker,
        bytes32 eventId,
        uint96 amount
    ) public {
        vm.assume(attacker != CONTROLLER);
        vm.assume(eventId != bytes32(0));
        vm.assume(amount > 0);

        token.mint(attacker, amount);
        vm.prank(attacker);
        token.approve(address(vault), amount);

        vm.prank(attacker);
        vm.expectRevert(bytes("QuarantineVault: not pause controller"));
        vault.deposit(eventId, address(token), amount, ORIGIN);
    }

    // ---------------------------------------------------------------
    // Fuzz: duplicate eventId always reverts
    // ---------------------------------------------------------------

    function testFuzz_Deposit_DuplicateEventIdReverts(
        bytes32 eventId,
        uint96 amount1,
        uint96 amount2
    ) public {
        vm.assume(eventId != bytes32(0));
        vm.assume(amount1 > 0 && amount2 > 0);

        token.mint(CONTROLLER, uint256(amount1) + uint256(amount2));
        vm.prank(CONTROLLER);
        token.approve(address(vault), type(uint256).max);

        vm.prank(CONTROLLER);
        vault.deposit(eventId, address(token), amount1, ORIGIN);

        vm.prank(CONTROLLER);
        vm.expectRevert(bytes("QuarantineVault: already exists"));
        vault.deposit(eventId, address(token), amount2, ORIGIN);
    }
}

// =================================================================
// Invariant tests: properties that must hold across ALL call sequences
// =================================================================

/// @dev Handler contracts define the sequence of operations Foundry will
///      randomize. The invariants then assert properties over the final
///      contract state after any valid sequence.
contract QuarantineVaultHandler is Test {
    QuarantineVault public vault;
    MockERC20 public token;
    address public controller;

    uint256 public totalDeposited;
    uint256 public totalReleased;
    bytes32[] public depositedEventIds;
    mapping(bytes32 => bool) public seen;

    constructor(QuarantineVault _vault, MockERC20 _token, address _controller) {
        vault = _vault;
        token = _token;
        controller = _controller;
    }

    function deposit(uint96 seed, uint96 amount) external {
        amount = uint96(bound(amount, 1, type(uint64).max));
        bytes32 eventId = keccak256(abi.encode(seed, block.number, depositedEventIds.length));
        if (seen[eventId]) return;

        token.mint(controller, amount);
        vm.prank(controller);
        token.approve(address(vault), amount);

        vm.prank(controller);
        vault.deposit(eventId, address(token), amount, address(0x0ABC));

        seen[eventId] = true;
        depositedEventIds.push(eventId);
        totalDeposited += amount;
    }

    function release(uint256 idx) external {
        if (depositedEventIds.length == 0) return;
        bytes32 eventId = depositedEventIds[idx % depositedEventIds.length];
        (, uint256 amount,, uint256 releaseTime, bool released) = vault.quarantines(eventId);
        if (released) return;
        if (block.timestamp < releaseTime) {
            vm.warp(releaseTime);
        }
        vault.release(eventId);
        totalReleased += amount;
    }

    function warp(uint256 seconds_) external {
        seconds_ = bound(seconds_, 0, 7 days);
        vm.warp(block.timestamp + seconds_);
    }

    function eventCount() external view returns (uint256) {
        return depositedEventIds.length;
    }
}

contract QuarantineVaultInvariantTest is StdInvariant, Test {
    QuarantineVault vault;
    MockERC20 token;
    QuarantineVaultHandler handler;
    address constant CONTROLLER = address(0xC0);

    function setUp() public {
        vault = new QuarantineVault();
        vault.setPauseController(CONTROLLER);
        token = new MockERC20();
        handler = new QuarantineVaultHandler(vault, token, CONTROLLER);

        targetContract(address(handler));
    }

    /// @dev Solvency invariant: the vault's token balance must always be
    ///      exactly `totalDeposited - totalReleased`. Any drift indicates
    ///      a bug (double-release, lost funds, or accounting error).
    function invariant_VaultSolvency() public {
        uint256 vaultBalance = token.balanceOf(address(vault));
        uint256 expectedBalance = handler.totalDeposited() - handler.totalReleased();
        assertEq(vaultBalance, expectedBalance, "vault balance != deposited - released");
    }

    /// @dev Released funds must equal origin balance (single origin in harness).
    function invariant_ReleasedEqualsOriginBalance() public {
        assertEq(
            token.balanceOf(address(0x0ABC)),
            handler.totalReleased(),
            "origin balance != totalReleased"
        );
    }
}
