// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {PolicyRegistry} from "../../src/PolicyRegistry.sol";
import {CounterfactualLedger} from "../../src/CounterfactualLedger.sol";
import {ThreatRegistry} from "../../src/ThreatRegistry.sol";
import {QuarantineVault} from "../../src/QuarantineVault.sol";
import {PauseController} from "../../src/PauseController.sol";
import {SentinelGuard} from "../../src/SentinelGuard.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockZKFixture} from "../helpers/MockZKFixture.sol";

/// @title Core unit tests
/// @notice Verifier wrappers now delegate to the canonical RISC Zero
///         verifier; tests back them with `RiscZeroMockVerifier` and
///         build valid mock seals via `MockZKFixture`.
contract PolicyRegistryTest is MockZKFixture {
    PolicyRegistry reg;
    address constant AGENT = address(0xA1);
    address constant EVE = address(0xEEE);

    function setUp() public {
        _deployMockZK();
        reg = new PolicyRegistry(address(policyVerifier), address(learningVerifier));
    }

    function test_Initialize_Once() public {
        reg.initialize(keccak256("p1"), AGENT);
        assertEq(reg.policyVersion(), 1);
        assertEq(reg.currentPolicyHash(), keccak256("p1"));
        assertEq(reg.defenseAgent(), AGENT);

        vm.expectRevert(bytes("PolicyRegistry: already initialized"));
        reg.initialize(keccak256("p2"), AGENT);
    }

    function test_Initialize_Rejects_Zero() public {
        vm.expectRevert(bytes("PolicyRegistry: empty policy hash"));
        reg.initialize(bytes32(0), AGENT);
    }

    function test_Initialize_OnlyOwner() public {
        vm.prank(EVE);
        vm.expectRevert(bytes("PolicyRegistry: not owner"));
        reg.initialize(keccak256("p"), AGENT);
    }

    function test_VerifyAndExecute_Rejects_NonAgent() public {
        reg.initialize(keccak256("p"), AGENT);
        bytes32[] memory inputs = new bytes32[](3);
        vm.prank(EVE);
        vm.expectRevert(bytes("PolicyRegistry: not agent"));
        reg.verifyAndExecute(address(0xdead), hex"", hex"deadbeef", inputs);
    }

    function test_PolicyVerifier_RejectsEmptySeal() public {
        bytes32[] memory pubs = new bytes32[](3);
        pubs[0] = bytes32(uint256(1));
        pubs[1] = bytes32(uint256(2));
        pubs[2] = bytes32(uint256(3));
        assertFalse(policyVerifier.verify(hex"", pubs), "empty seal must be rejected");
    }

    function test_PolicyVerifier_RejectsWrongInputCount() public {
        bytes32[] memory pubs = new bytes32[](2);
        pubs[0] = bytes32(uint256(1));
        pubs[1] = bytes32(uint256(2));
        bytes memory seal = _policySeal(pubs);
        assertFalse(policyVerifier.verify(seal, pubs), "wrong input count must be rejected");
    }

    function test_PolicyVerifier_AcceptsValidMockSeal() public {
        bytes32[] memory pubs = new bytes32[](3);
        pubs[0] = bytes32(uint256(1));
        pubs[1] = bytes32(uint256(2));
        pubs[2] = bytes32(uint256(3));
        bytes memory seal = _policySeal(pubs);
        assertTrue(policyVerifier.verify(seal, pubs), "valid mock seal must verify");
    }

    function test_PolicyVerifier_RejectsTamperedInputs() public {
        bytes32[] memory pubs = new bytes32[](3);
        pubs[0] = bytes32(uint256(1));
        pubs[1] = bytes32(uint256(2));
        pubs[2] = bytes32(uint256(3));
        bytes memory seal = _policySeal(pubs);
        // Seal bound to original inputs; swapping one must break verification.
        pubs[2] = bytes32(uint256(99));
        assertFalse(policyVerifier.verify(seal, pubs), "tampered inputs must be rejected");
    }

    function test_UpdatePolicy_Rejects_BadOldHash() public {
        reg.initialize(keccak256("p1"), AGENT);
        bytes32[] memory inputs = new bytes32[](2);
        inputs[0] = keccak256("wrong");
        inputs[1] = keccak256("p2");
        vm.expectRevert(bytes("PolicyRegistry: stale old hash"));
        reg.updatePolicy(keccak256("p2"), hex"", inputs);
    }
}

contract PolicyRegistryUpdateTest is MockZKFixture {
    PolicyRegistry registry;
    address constant AGENT = address(0xA1);
    bytes32 constant OLD = bytes32(uint256(0x123));

    function setUp() public {
        _deployMockZK();
        registry = new PolicyRegistry(address(policyVerifier), address(learningVerifier));
        registry.initialize(OLD, AGENT);
    }

    function _learningInputs(bytes32 oldHash, bytes32 newHash)
        internal
        pure
        returns (bytes32[] memory)
    {
        // LearningVerifier expects 4 inputs: [old, new, winRateBp, generationCount].
        bytes32[] memory inputs = new bytes32[](4);
        inputs[0] = oldHash;
        inputs[1] = newHash;
        inputs[2] = bytes32(uint256(8500)); // 85% win rate
        inputs[3] = bytes32(uint256(100));  // 100 generations
        return inputs;
    }

    function test_UpdatePolicy_Happy() public {
        bytes32 newHash = bytes32(uint256(0x456));
        bytes32[] memory inputs = _learningInputs(OLD, newHash);
        bytes memory seal = _learningSeal(inputs);

        bool success = registry.updatePolicy(newHash, seal, inputs);
        assertTrue(success);
        assertEq(registry.currentPolicyHash(), newHash);
        assertEq(registry.policyVersion(), 2);
    }

    function test_UpdatePolicy_RejectsZeroHash() public {
        bytes32[] memory inputs = _learningInputs(OLD, bytes32(0));
        vm.expectRevert(bytes("PolicyRegistry: empty policy hash"));
        registry.updatePolicy(bytes32(0), hex"cafecafe", inputs);
    }

    function test_UpdatePolicy_RejectsSameHash() public {
        bytes32[] memory inputs = _learningInputs(OLD, OLD);
        vm.expectRevert(bytes("PolicyRegistry: unchanged"));
        registry.updatePolicy(OLD, hex"cafecafe", inputs);
    }

    function test_UpdatePolicy_RejectsOldHashMismatch() public {
        bytes32 newHash = bytes32(uint256(0x456));
        bytes32[] memory inputs = _learningInputs(bytes32(uint256(0x999)), newHash);
        vm.expectRevert(bytes("PolicyRegistry: stale old hash"));
        registry.updatePolicy(newHash, hex"cafecafe", inputs);
    }

    function test_UpdatePolicy_RejectsInvalidSeal() public {
        bytes32 newHash = bytes32(uint256(0x456));
        bytes32[] memory inputs = _learningInputs(OLD, newHash);
        // Bogus seal: valid length but wrong selector → wrapper.verify returns false.
        vm.expectRevert(bytes("PolicyRegistry: invalid learning proof"));
        registry.updatePolicy(newHash, hex"deadbeef", inputs);
    }

    function test_UpdatePolicy_EmitsEvent() public {
        bytes32 newHash = bytes32(uint256(0x456));
        bytes32[] memory inputs = _learningInputs(OLD, newHash);
        bytes memory seal = _learningSeal(inputs);

        vm.expectEmit(true, true, true, true);
        emit PolicyRegistry.PolicyUpdated(OLD, newHash, address(this), 2);

        registry.updatePolicy(newHash, seal, inputs);
    }

    function test_UpdatePolicy_DevMode_RejectsEmptyProof() public {
        registry.setLearningVerifier(address(0));
        bytes32 newHash = bytes32(uint256(0x456));
        bytes32[] memory inputs = _learningInputs(OLD, newHash);
        vm.expectRevert(bytes("PolicyRegistry: empty proof"));
        registry.updatePolicy(newHash, hex"", inputs);
    }

    function test_SetLearningVerifier_OnlyOwner() public {
        address eve = address(0xEEE);
        vm.prank(eve);
        vm.expectRevert(bytes("PolicyRegistry: not owner"));
        registry.setLearningVerifier(address(0));
    }
}

contract PauseControllerTest is MockZKFixture {
    PolicyRegistry reg;
    QuarantineVault vault;
    PauseController pc;
    address constant TARGET = address(0x7A80);
    address constant AGENT = address(0xA1);

    function setUp() public {
        _deployMockZK();
        reg = new PolicyRegistry(address(policyVerifier), address(learningVerifier));
        vault = new QuarantineVault();
        pc = new PauseController(address(reg), address(vault));
        vault.setPauseController(address(pc));
        reg.initialize(keccak256("p"), AGENT);
    }

    function test_Activate_OnlyPolicyRegistry() public {
        vm.expectRevert(bytes("PauseController: not policy registry"));
        pc.activate(TARGET, PauseController.DefenseType.Pause, keccak256("e"));
    }

    function test_Activate_Happy_And_Deactivate() public {
        vm.prank(address(reg));
        pc.activate(TARGET, PauseController.DefenseType.Pause, keccak256("e1"));
        assertTrue(pc.isPaused(TARGET));

        pc.deactivate(TARGET);
        assertFalse(pc.isPaused(TARGET));
    }

    function test_Activate_Rejects_Double() public {
        vm.startPrank(address(reg));
        pc.activate(TARGET, PauseController.DefenseType.Pause, keccak256("e1"));
        vm.expectRevert(bytes("PauseController: already active"));
        pc.activate(TARGET, PauseController.DefenseType.Pause, keccak256("e2"));
    }
}

contract SentinelGuardTest is MockZKFixture {
    PolicyRegistry reg;
    QuarantineVault vault;
    PauseController pc;
    SentinelGuard guard;
    address constant TARGET = address(0xDEAD);
    address constant AGENT = address(0xA1);

    function setUp() public {
        _deployMockZK();
        reg = new PolicyRegistry(address(policyVerifier), address(learningVerifier));
        vault = new QuarantineVault();
        pc = new PauseController(address(reg), address(vault));
        vault.setPauseController(address(pc));
        guard = new SentinelGuard(address(pc));
        reg.initialize(keccak256("p"), AGENT);
    }

    function test_AllowedByDefault() public {
        assertTrue(guard.isAllowed(TARGET, bytes4(0x12345678)));
    }

    function test_BlockedAfterPause() public {
        vm.prank(address(reg));
        pc.activate(TARGET, PauseController.DefenseType.Pause, keccak256("e"));
        assertFalse(guard.isAllowed(TARGET, bytes4(0x12345678)));
    }
}

contract CounterfactualLedgerTest is MockZKFixture {
    CounterfactualLedger ledger;
    address constant PROVER = address(0xB2);
    address constant VICTIM = address(0xBEEFCAFE);

    function setUp() public {
        _deployMockZK();
        ledger = new CounterfactualLedger(address(counterfactualVerifier), PROVER);
    }

    function _stubEntry(bytes32 eventId) internal view returns (CounterfactualLedger.Entry memory) {
        return CounterfactualLedger.Entry({
            eventId: eventId,
            atBlock: block.number,
            deltaWei: int256(1e18),
            realTxHash: keccak256("tx"),
            counterfactualRoot: keccak256("root"),
            proofDigest: keccak256("proof"),
            recordedAt: 0
        });
    }

    function _inputsFor(CounterfactualLedger.Entry memory e) internal pure returns (bytes32[] memory) {
        // CounterfactualVerifier requires exactly 5 inputs matching the
        // 160-byte journal: [eventId, root, delta, victim, forkBlockHash].
        bytes32[] memory inputs = new bytes32[](5);
        inputs[0] = e.eventId;
        inputs[1] = e.counterfactualRoot;
        inputs[2] = bytes32(uint256(e.deltaWei));
        inputs[3] = bytes32(uint256(uint160(VICTIM)));
        inputs[4] = bytes32(0); // forkBlockHash: zero = Approach B (structural only)
        return inputs;
    }

    function test_Record_OnlyProver() public {
        CounterfactualLedger.Entry memory e = _stubEntry(keccak256("e1"));
        bytes32[] memory inputs = _inputsFor(e);
        bytes memory seal = _counterfactualSeal(inputs);
        vm.expectRevert(bytes("CounterfactualLedger: not prover"));
        ledger.record(e, seal, inputs);
    }

    function test_Record_Happy() public {
        CounterfactualLedger.Entry memory e = _stubEntry(keccak256("happy"));
        bytes32[] memory inputs = _inputsFor(e);
        bytes memory seal = _counterfactualSeal(inputs);
        vm.prank(PROVER);
        ledger.record(e, seal, inputs);
        assertEq(ledger.getEntryCount(), 1);
        assertEq(ledger.getEntry(keccak256("happy")).eventId, keccak256("happy"));
    }

    function test_Record_NoOverwrite() public {
        CounterfactualLedger.Entry memory e = _stubEntry(keccak256("e1"));
        bytes32[] memory inputs = _inputsFor(e);
        bytes memory seal = _counterfactualSeal(inputs);
        vm.startPrank(PROVER);
        ledger.record(e, seal, inputs);
        vm.expectRevert(bytes("CounterfactualLedger: already recorded"));
        ledger.record(e, seal, inputs);
        assertEq(ledger.getEntryCount(), 1);
    }

    function test_Record_RejectsEmptyEventId() public {
        CounterfactualLedger.Entry memory e = _stubEntry(bytes32(0));
        bytes32[] memory inputs = _inputsFor(e);
        vm.startPrank(PROVER);
        vm.expectRevert(bytes("CounterfactualLedger: empty eventId"));
        ledger.record(e, hex"", inputs);
    }

    function test_Record_RejectsEventIdMismatch() public {
        CounterfactualLedger.Entry memory e = _stubEntry(keccak256("e2"));
        bytes32[] memory inputs = _inputsFor(e);
        inputs[0] = keccak256("other");
        vm.startPrank(PROVER);
        vm.expectRevert(bytes("CounterfactualLedger: eventId mismatch"));
        ledger.record(e, hex"", inputs);
    }

    function test_Record_RejectsInvalidSeal() public {
        CounterfactualLedger.Entry memory e = _stubEntry(keccak256("bad-seal"));
        bytes32[] memory inputs = _inputsFor(e);
        vm.startPrank(PROVER);
        vm.expectRevert(bytes("CounterfactualLedger: invalid proof"));
        ledger.record(e, hex"deadbeef", inputs);
    }

    function test_GetEntryAt_RevertsOutOfRange() public {
        vm.expectRevert(bytes("CounterfactualLedger: index out of range"));
        ledger.getEntryAt(0);
    }

    /// @notice Fuzz: unique non-zero eventIds always map 1:1 after record.
    function testFuzz_Record_RoundTrip(bytes32 eventId) public {
        vm.assume(eventId != bytes32(0));
        CounterfactualLedger.Entry memory e = _stubEntry(eventId);
        bytes32[] memory inputs = _inputsFor(e);
        bytes memory seal = _counterfactualSeal(inputs);
        vm.startPrank(PROVER);
        ledger.record(e, seal, inputs);
        CounterfactualLedger.Entry memory got = ledger.getEntry(eventId);
        assertEq(got.eventId, eventId);
        assertEq(got.deltaWei, e.deltaWei);
        assertEq(ledger.getEntryCount(), 1);
    }
}

contract ThreatRegistryTest is Test {
    ThreatRegistry reg;
    address constant OP = address(0xC3);

    function setUp() public {
        reg = new ThreatRegistry(OP);
    }

    function test_Publish_OnlyOperator() public {
        ThreatRegistry.Signature memory s = ThreatRegistry.Signature({
            signatureHash: keccak256("s1"),
            defensePrimitive: keccak256("pause"),
            confidence: 9000,
            derivationProof: keccak256("p"),
            publishedAt: 0
        });
        vm.expectRevert(bytes("ThreatRegistry: not operator"));
        reg.publish(s);

        vm.prank(OP);
        reg.publish(s);
        assertEq(reg.getAll().length, 1);
    }
}

contract QuarantineVaultTest is Test {
    QuarantineVault vault;
    MockERC20 token;
    address constant CONTROLLER = address(0xC0);
    address constant ORIGIN = address(0xDEAD);

    function setUp() public {
        vault = new QuarantineVault();
        vault.setPauseController(CONTROLLER);
        token = new MockERC20("X", "X", 18);
        token.mint(CONTROLLER, 100e18);
        vm.prank(CONTROLLER);
        token.approve(address(vault), 100e18);
    }

    function test_Deposit_And_ReleaseAfterTime() public {
        vm.prank(CONTROLLER);
        vault.deposit(keccak256("e"), address(token), 10e18, ORIGIN);
        assertEq(token.balanceOf(address(vault)), 10e18);

        vm.expectRevert(bytes("QuarantineVault: too early"));
        vault.release(keccak256("e"));

        vm.warp(block.timestamp + 72 hours + 1);
        vault.release(keccak256("e"));
        assertEq(token.balanceOf(ORIGIN), 10e18);
    }

    function test_Deposit_OnlyController() public {
        vm.expectRevert(bytes("QuarantineVault: not pause controller"));
        vault.deposit(keccak256("e"), address(token), 10e18, ORIGIN);
    }
}
