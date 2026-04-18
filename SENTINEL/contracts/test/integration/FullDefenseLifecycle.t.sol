// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";

import {PolicyRegistry} from "../../src/PolicyRegistry.sol";
import {QuarantineVault} from "../../src/QuarantineVault.sol";
import {PauseController} from "../../src/PauseController.sol";
import {SentinelGuard} from "../../src/SentinelGuard.sol";
import {VictimLendingPool} from "../../src/VictimLendingPool.sol";
import {ThreatRegistry} from "../../src/ThreatRegistry.sol";
import {CounterfactualLedger} from "../../src/CounterfactualLedger.sol";
import {FlashLoanAttacker} from "../../src/demo/FlashLoanAttacker.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockOraclePair} from "../../src/mocks/MockOraclePair.sol";
import {MockFlashLoanProvider} from "../../src/mocks/MockFlashLoanProvider.sol";
import {MockZKFixture} from "../helpers/MockZKFixture.sol";

/// @title FullDefenseLifecycleTest
/// @notice End-to-end on-chain test covering the full defense lifecycle
///         across all seven contracts in a single flow:
///
///   1. ThreatRegistry publishes an attack signature (immunity propagation)
///   2. Attacker tx is blocked by SentinelGuard.isAllowedEnhanced (off-chain
///      monitoring would have matched the signature and fired the defense)
///   3. Defense agent submits verifyAndExecute → PolicyRegistry verifies the
///      ZK proof and activates the PauseController defense
///   4. CounterfactualLedger records the prevented delta with its proof digest
///   5. Post-release, victim can re-borrow once the pause is deactivated
contract FullDefenseLifecycleTest is MockZKFixture {
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
    ThreatRegistry threatRegistry;
    CounterfactualLedger counterfactualLedger;

    // --- Demo contracts ---
    MockERC20 usdc;
    MockERC20 weth;
    MockOraclePair oraclePair;
    MockFlashLoanProvider flashLoanProvider;
    VictimLendingPool victim;
    FlashLoanAttacker attackerContract;

    bytes32 constant POLICY_HASH = keccak256("lifecycle-policy-v1");
    bytes32 constant ATTACK_SIGNATURE = keccak256("flash-loan-oracle-manip-v1");

    function setUp() public {
        _deployMockZK();
        policyRegistry = new PolicyRegistry(address(policyVerifier), address(learningVerifier));

        quarantineVault = new QuarantineVault();
        pauseController = new PauseController(address(policyRegistry), address(quarantineVault));
        quarantineVault.setPauseController(address(pauseController));
        sentinelGuard = new SentinelGuard(address(pauseController));

        threatRegistry = new ThreatRegistry(OPERATOR);
        sentinelGuard.setThreatRegistry(address(threatRegistry));
        counterfactualLedger = new CounterfactualLedger(address(counterfactualVerifier), PROVER);

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

        policyRegistry.initialize(POLICY_HASH, DEFENSE_AGENT);
    }

    /// @notice Full happy-path lifecycle: signature → immunity → defense →
    ///         ledger entry → deactivation → borrow resumes. Split into
    ///         helpers to keep the stack shallow.
    function test_FullLifecycle_FederatedDefense() public {
        bytes32 eventId = keccak256("lifecycle-event");
        _publishAndVerifySignature();
        _executeDefense(eventId);
        _attemptAttackAndRevert();
        _recordCounterfactualEntry(eventId);
        _deactivateAndResumeBorrow();
    }

    function _publishAndVerifySignature() internal {
        ThreatRegistry.Signature memory sig = ThreatRegistry.Signature({
            signatureHash: ATTACK_SIGNATURE,
            defensePrimitive: keccak256("pause"),
            confidence: 9700,
            derivationProof: keccak256("ml-derivation-proof"),
            publishedAt: 0
        });
        vm.prank(OPERATOR);
        threatRegistry.publish(sig);
        assertTrue(threatRegistry.isThreat(ATTACK_SIGNATURE));
        assertFalse(
            sentinelGuard.isAllowedEnhanced(address(victim), bytes4(0x12345678), ATTACK_SIGNATURE),
            "known threat must be blocked"
        );
    }

    function _executeDefense(bytes32 eventId) internal {
        bytes memory action = abi.encodeCall(
            PauseController.activate,
            (address(victim), PauseController.DefenseType.Pause, eventId)
        );
        bytes32 actionHash = keccak256(abi.encodePacked(address(pauseController), action));
        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = actionHash;
        publicInputs[1] = POLICY_HASH;
        publicInputs[2] = eventId;
        bytes memory seal = _policySeal(publicInputs);

        vm.prank(DEFENSE_AGENT);
        bool ok = policyRegistry.verifyAndExecute(
            address(pauseController), action, seal, publicInputs
        );
        assertTrue(ok);
        assertTrue(pauseController.isPaused(address(victim)));
    }

    function _attemptAttackAndRevert() internal {
        vm.expectRevert(bytes("SENTINEL: halted"));
        vm.prank(ATTACKER);
        attackerContract.attack(address(flashLoanProvider), 900e18);
    }

    function _recordCounterfactualEntry(bytes32 eventId) internal {
        int256 deltaWei = -500e18;
        bytes32 root = keccak256("merkle-of-victim-balances");
        CounterfactualLedger.Entry memory entry = CounterfactualLedger.Entry({
            eventId: eventId,
            atBlock: block.number,
            deltaWei: deltaWei,
            realTxHash: keccak256("defense-tx"),
            counterfactualRoot: root,
            proofDigest: keccak256("ledger-proof"),
            recordedAt: 0
        });
        bytes32[] memory inputs = new bytes32[](5);
        inputs[0] = eventId;
        inputs[1] = root;
        inputs[2] = bytes32(uint256(deltaWei));
        inputs[3] = bytes32(uint256(uint160(address(victim))));
        inputs[4] = bytes32(0);
        bytes memory seal = _counterfactualSeal(inputs);

        vm.prank(PROVER);
        counterfactualLedger.record(entry, seal, inputs);

        assertEq(counterfactualLedger.getEntryCount(), 1);
        int256 storedDelta;
        (, , storedDelta, , , , ) = counterfactualLedger.entries(eventId);
        assertEq(storedDelta, deltaWei);
    }

    function _deactivateAndResumeBorrow() internal {
        pauseController.deactivate(address(victim));
        assertFalse(pauseController.isPaused(address(victim)));

        usdc.mint(LP, 10_000e6);
        vm.startPrank(LP);
        usdc.approve(address(victim), 10_000e6);
        victim.deposit(5_000e6);
        uint256 usdcPerEth = oraclePair.getPrice(address(weth));
        uint256 collateralInWeth = (5_000e6 * 1e18) / usdcPerEth;
        uint256 maxWeth = (collateralInWeth * victim.LTV_BPS()) / victim.BPS_DENOM();
        victim.borrow(maxWeth);
        vm.stopPrank();
        assertGt(victim.debtOf(LP), 0);
    }

    /// @notice Verify that a stale threat signature (past TTL) no longer
    ///         blocks at the immunity check — expired intel expires.
    function test_ExpiredThreatSignature_NoLongerBlocks() public {
        ThreatRegistry.Signature memory sig = ThreatRegistry.Signature({
            signatureHash: ATTACK_SIGNATURE,
            defensePrimitive: keccak256("pause"),
            confidence: 9500,
            derivationProof: bytes32(0),
            publishedAt: 0
        });
        vm.prank(OPERATOR);
        threatRegistry.publish(sig);

        // Advance beyond the default 7-day TTL.
        vm.warp(block.timestamp + 7 days + 1);

        assertFalse(threatRegistry.isThreat(ATTACK_SIGNATURE), "sig should be expired");
        assertTrue(
            sentinelGuard.isAllowedEnhanced(address(victim), bytes4(0x12345678), ATTACK_SIGNATURE),
            "expired sig must not block"
        );
    }

    /// @notice Ledger is append-only: you cannot record twice for the same
    ///         event ID even with a fresh proof. This protects historical
    ///         audits from being rewritten.
    function test_CounterfactualLedger_IsAppendOnly() public {
        bytes32 eventId = keccak256("dup-event");
        int256 deltaWei = -100e18;
        bytes32 root = keccak256("r");

        CounterfactualLedger.Entry memory entry = CounterfactualLedger.Entry({
            eventId: eventId,
            atBlock: block.number,
            deltaWei: deltaWei,
            realTxHash: bytes32(0),
            counterfactualRoot: root,
            proofDigest: bytes32(0),
            recordedAt: 0
        });
        bytes32[] memory inputs = new bytes32[](5);
        inputs[0] = eventId;
        inputs[1] = root;
        inputs[2] = bytes32(uint256(deltaWei));
        inputs[3] = bytes32(uint256(uint160(address(victim))));
        inputs[4] = bytes32(0);
        bytes memory seal = _counterfactualSeal(inputs);

        vm.prank(PROVER);
        counterfactualLedger.record(entry, seal, inputs);

        vm.prank(PROVER);
        vm.expectRevert(bytes("CounterfactualLedger: already recorded"));
        counterfactualLedger.record(entry, seal, inputs);
    }

    /// @notice Only the designated prover may write to the ledger.
    function test_CounterfactualLedger_OnlyProverCanRecord() public {
        bytes32 eventId = keccak256("attempt");
        bytes32 root = keccak256("r");
        int256 deltaWei = -1e18;

        CounterfactualLedger.Entry memory entry = CounterfactualLedger.Entry({
            eventId: eventId,
            atBlock: block.number,
            deltaWei: deltaWei,
            realTxHash: bytes32(0),
            counterfactualRoot: root,
            proofDigest: bytes32(0),
            recordedAt: 0
        });
        bytes32[] memory inputs = new bytes32[](5);
        inputs[0] = eventId;
        inputs[1] = root;
        inputs[2] = bytes32(uint256(deltaWei));
        inputs[3] = bytes32(uint256(uint160(address(victim))));
        inputs[4] = bytes32(0);
        bytes memory seal = _counterfactualSeal(inputs);

        vm.prank(ATTACKER);
        vm.expectRevert(bytes("CounterfactualLedger: not prover"));
        counterfactualLedger.record(entry, seal, inputs);
    }

    /// @notice The complete defense sequence must be idempotent: repeating
    ///         verifyAndExecute on an already-active defense is a revert,
    ///         not a silent no-op. This prevents attackers from re-emitting
    ///         valid proofs to confuse event ordering downstream.
    function test_DuplicateDefenseIsBlocked() public {
        bytes32 eventId = keccak256("dup-defense");
        bytes memory action = abi.encodeCall(
            PauseController.activate,
            (address(victim), PauseController.DefenseType.Pause, eventId)
        );
        bytes32 actionHash = keccak256(abi.encodePacked(address(pauseController), action));
        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = actionHash;
        publicInputs[1] = POLICY_HASH;
        publicInputs[2] = eventId;
        bytes memory seal = _policySeal(publicInputs);

        vm.prank(DEFENSE_AGENT);
        policyRegistry.verifyAndExecute(address(pauseController), action, seal, publicInputs);

        // Same action against the now-active defense reverts inside
        // PauseController.activate (already active).
        vm.prank(DEFENSE_AGENT);
        vm.expectRevert(bytes("PolicyRegistry: target call failed"));
        policyRegistry.verifyAndExecute(address(pauseController), action, seal, publicInputs);
    }
}
