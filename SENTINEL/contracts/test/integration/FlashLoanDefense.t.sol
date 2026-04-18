// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";

import {PolicyRegistry} from "../../src/PolicyRegistry.sol";
import {QuarantineVault} from "../../src/QuarantineVault.sol";
import {PauseController} from "../../src/PauseController.sol";
import {SentinelGuard} from "../../src/SentinelGuard.sol";
import {VictimLendingPool} from "../../src/VictimLendingPool.sol";
import {FlashLoanAttacker} from "../../src/demo/FlashLoanAttacker.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockOraclePair} from "../../src/mocks/MockOraclePair.sol";
import {MockFlashLoanProvider} from "../../src/mocks/MockFlashLoanProvider.sol";
import {MockZKFixture} from "../helpers/MockZKFixture.sol";

/// @title FlashLoanDefenseTest
/// @notice Attack succeeds without Sentinel, reverts with Sentinel. The
///         `Defense_Flow_VerifyAndExecute` path now exercises a real
///         RISC Zero mock seal — swapping in the production verifier in
///         `DeployLocal.s.sol` requires zero code changes here.
contract FlashLoanDefenseTest is MockZKFixture {
    // --- Accounts ---
    address constant DEFENSE_AGENT = address(0xA1);
    address constant PROVER = address(0xB2);
    address constant OPERATOR = address(0xC3);
    address constant ATTACKER = address(0xA77ACE);
    address constant LP = address(0xBEEF);

    // --- Core contracts ---
    PolicyRegistry policyRegistry;
    PauseController pauseController;
    SentinelGuard sentinelGuard;
    QuarantineVault quarantineVault;

    // --- Demo contracts ---
    MockERC20 usdc;
    MockERC20 weth;
    MockOraclePair oraclePair;
    MockFlashLoanProvider flashLoanProvider;
    VictimLendingPool victim;
    FlashLoanAttacker attackerContract;

    function setUp() public {
        _deployMockZK();
        policyRegistry = new PolicyRegistry(address(policyVerifier), address(learningVerifier));

        quarantineVault = new QuarantineVault();
        pauseController = new PauseController(address(policyRegistry), address(quarantineVault));
        quarantineVault.setPauseController(address(pauseController));
        sentinelGuard = new SentinelGuard(address(pauseController));

        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        weth = new MockERC20("Mock WETH", "mWETH", 18);
        oraclePair = new MockOraclePair(address(usdc), address(weth));
        flashLoanProvider = new MockFlashLoanProvider(address(weth));

        victim = new VictimLendingPool(
            address(sentinelGuard),
            address(usdc),
            address(weth),
            address(oraclePair)
        );

        usdc.mint(address(this), 10_000e6);
        weth.mint(address(this), 1_000e18);
        usdc.approve(address(oraclePair), 10_000e6);
        weth.approve(address(oraclePair), 1_000e18);
        oraclePair.seed(10_000e6, 1_000e18);

        weth.mint(address(flashLoanProvider), 5_000e18);

        weth.mint(LP, 10_000e18);
        vm.startPrank(LP);
        weth.approve(address(victim), 10_000e18);
        victim.fundLiquidity(10_000e18);
        vm.stopPrank();

        vm.prank(ATTACKER);
        attackerContract = new FlashLoanAttacker(
            address(victim),
            address(oraclePair),
            address(usdc),
            address(weth)
        );

        policyRegistry.initialize(keccak256("test-policy"), DEFENSE_AGENT);
    }

    function test_PreAttackBaseline() public {
        assertEq(victim.availableLiquidity(), 10_000e18, "victim WETH liquidity");
        assertEq(weth.balanceOf(address(attackerContract)), 0, "attacker WETH before");
        (uint256 r0, uint256 r1) = oraclePair.getReserves();
        assertEq(r0, 10_000e6);
        assertEq(r1, 1_000e18);
    }

    function test_Attack_Succeeds_Without_Sentinel() public {
        uint256 victimLiquidityBefore = victim.availableLiquidity();
        uint256 attackerWethBefore = weth.balanceOf(address(attackerContract));

        vm.prank(ATTACKER);
        attackerContract.attack(address(flashLoanProvider), 900e18);

        uint256 victimLiquidityAfter = victim.availableLiquidity();
        uint256 attackerWethAfter = weth.balanceOf(address(attackerContract));
        uint256 drained = attackerWethAfter - attackerWethBefore;

        console2.log("Attacker kept (wei WETH):", drained);
        console2.log("Victim liquidity before :", victimLiquidityBefore);
        console2.log("Victim liquidity after  :", victimLiquidityAfter);

        assertGt(drained, 0, "attacker should have netted WETH");
        assertLt(victimLiquidityAfter, victimLiquidityBefore, "victim liquidity dropped");
    }

    function test_Borrow_Reverts_When_Paused() public {
        usdc.mint(ATTACKER, 10_000e6);
        vm.startPrank(ATTACKER);
        usdc.approve(address(victim), 10_000e6);
        victim.deposit(1_000e6);
        vm.stopPrank();

        vm.prank(address(policyRegistry));
        pauseController.activate(
            address(victim),
            PauseController.DefenseType.Pause,
            keccak256("pause-borrow")
        );

        vm.startPrank(ATTACKER);
        vm.expectRevert(bytes("SENTINEL: halted"));
        victim.borrow(1e18);
        vm.stopPrank();
    }

    function test_Borrow_Succeeds_When_Not_Paused() public {
        usdc.mint(ATTACKER, 10_000e6);
        vm.startPrank(ATTACKER);
        usdc.approve(address(victim), 10_000e6);
        uint256 collateral = 5_000e6;
        victim.deposit(collateral);
        uint256 usdcPerEth = oraclePair.getPrice(address(weth));
        uint256 collateralInWeth = (collateral * 1e18) / usdcPerEth;
        uint256 maxWeth = (collateralInWeth * victim.LTV_BPS()) / victim.BPS_DENOM();
        victim.borrow(maxWeth);
        vm.stopPrank();
        assertGt(victim.debtOf(ATTACKER), 0, "borrow should create debt");
    }

    function test_Attack_Fails_With_Sentinel_Paused() public {
        vm.prank(address(policyRegistry));
        pauseController.activate(
            address(victim),
            PauseController.DefenseType.Pause,
            keccak256("phase2-event-1")
        );
        assertTrue(pauseController.isPaused(address(victim)), "should be paused");

        vm.expectRevert(bytes("SENTINEL: halted"));
        vm.prank(ATTACKER);
        attackerContract.attack(address(flashLoanProvider), 900e18);
    }

    function test_Defense_Flow_VerifyAndExecute() public {
        // Exercise the full PolicyRegistry.verifyAndExecute path using a
        // valid RISC Zero mock seal. Swap the mock for
        // RiscZeroGroth16Verifier in production and no test edits are
        // needed — the interface is identical.
        bytes32 eventId = keccak256("e2e-event");
        bytes memory action = abi.encodeCall(
            PauseController.activate,
            (address(victim), PauseController.DefenseType.Pause, eventId)
        );
        bytes32 actionHash = keccak256(abi.encodePacked(address(pauseController), action));
        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = actionHash;
        publicInputs[1] = policyRegistry.currentPolicyHash();
        publicInputs[2] = eventId;

        bytes memory seal = _policySeal(publicInputs);

        vm.prank(DEFENSE_AGENT);
        bool success = policyRegistry.verifyAndExecute(
            address(pauseController),
            action,
            seal,
            publicInputs
        );

        assertTrue(success);
        assertTrue(pauseController.isPaused(address(victim)), "victim paused via agent path");
    }

    function test_Defense_Rejects_StalePolicyHash() public {
        bytes32 eventId = keccak256("stale");
        bytes memory action = abi.encodeCall(
            PauseController.activate,
            (address(victim), PauseController.DefenseType.Pause, eventId)
        );
        bytes32 actionHash = keccak256(abi.encodePacked(address(pauseController), action));
        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = actionHash;
        publicInputs[1] = keccak256("wrong-policy");
        publicInputs[2] = eventId;

        vm.expectRevert(bytes("PolicyRegistry: stale policy"));
        vm.prank(DEFENSE_AGENT);
        policyRegistry.verifyAndExecute(
            address(pauseController),
            action,
            hex"deadbeef",
            publicInputs
        );
    }

    function test_Defense_Rejects_InvalidProof() public {
        // Scenario B: an invalid seal must cause PolicyVerifier.verify
        // to return false → PolicyRegistry reverts with INVALID_PROOF.
        // This is the visible demo moment for Agent Constraint Failure.
        bytes32 eventId = keccak256("scenario-b");
        bytes memory action = abi.encodeCall(
            PauseController.activate,
            (address(victim), PauseController.DefenseType.Pause, eventId)
        );
        bytes32 actionHash = keccak256(abi.encodePacked(address(pauseController), action));
        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = actionHash;
        publicInputs[1] = policyRegistry.currentPolicyHash();
        publicInputs[2] = eventId;

        vm.expectRevert(bytes("PolicyRegistry: invalid proof"));
        vm.prank(DEFENSE_AGENT);
        policyRegistry.verifyAndExecute(
            address(pauseController),
            action,
            hex"",
            publicInputs
        );
    }
}
