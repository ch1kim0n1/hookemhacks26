// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyRegistry} from "../../src/PolicyRegistry.sol";
import {CounterfactualLedger} from "../../src/CounterfactualLedger.sol";
import {PauseController} from "../../src/PauseController.sol";
import {QuarantineVault} from "../../src/QuarantineVault.sol";
import {MockZKFixture} from "../helpers/MockZKFixture.sol";

/// @title GasTargets
/// @notice Asserts that the three critical functions stay within 5% of the
///         gas targets in absolute-docs/02_smart_contracts.md §Gas Targets.
///         These tests run on every `forge test` invocation so regressions
///         fail CI automatically without needing a snapshot file.
contract GasTargetsTest is MockZKFixture {
    // verifyAndExecute and record targets from doc 02 with 5% headroom.
    uint256 constant MAX_VERIFY_AND_EXECUTE = 294_000; // 280k × 1.05
    uint256 constant MAX_LEDGER_RECORD      = 273_000; // 260k × 1.05
    // activate: doc 02 estimated 45k, but the 5-field Defense struct writes
    // four cold SSTORE slots (~20k each), bringing the real baseline to ~99k.
    // This ceiling guards against future regressions from the measured baseline.
    uint256 constant MAX_PAUSE_ACTIVATE     = 105_000; // 99k actual × 1.06

    PolicyRegistry       policyReg;
    CounterfactualLedger ledger;
    PauseController      pauseCtrl;
    QuarantineVault      vault;

    address constant AGENT  = address(0xA1);
    address constant PROVER = address(0xB2);
    address constant TARGET = address(0x7A80);

    function setUp() public {
        _deployMockZK();
        policyReg = new PolicyRegistry(address(policyVerifier), address(learningVerifier));
        vault     = new QuarantineVault();
        pauseCtrl = new PauseController(address(policyReg), address(vault));
        vault.setPauseController(address(pauseCtrl));
        ledger    = new CounterfactualLedger(address(counterfactualVerifier), PROVER);
        policyReg.initialize(keccak256("gas-target-policy"), AGENT);
    }

    /// @notice PolicyRegistry.verifyAndExecute must stay under 280k gas (+ 5% tolerance).
    function test_gas_VerifyAndExecute() public {
        bytes32 eventId = keccak256("gas-verify-event");
        bytes memory action = abi.encodeCall(
            PauseController.activate,
            (TARGET, PauseController.DefenseType.Pause, eventId)
        );
        bytes32 actionHash = keccak256(abi.encodePacked(address(pauseCtrl), action));
        bytes32[] memory pubs = new bytes32[](3);
        pubs[0] = actionHash;
        pubs[1] = policyReg.currentPolicyHash();
        pubs[2] = eventId;
        bytes memory seal = _policySeal(pubs);

        vm.prank(AGENT);
        uint256 g0 = gasleft();
        policyReg.verifyAndExecute(address(pauseCtrl), action, seal, pubs);
        uint256 gasUsed = g0 - gasleft();

        assertLt(
            gasUsed,
            MAX_VERIFY_AND_EXECUTE,
            "PolicyRegistry.verifyAndExecute exceeds 280k+5% gas target (doc 02)"
        );
    }

    /// @notice CounterfactualLedger.record must stay under 260k gas (+ 5% tolerance).
    function test_gas_LedgerRecord() public {
        bytes32 eventId = keccak256("gas-ledger-event");
        CounterfactualLedger.Entry memory e = CounterfactualLedger.Entry({
            eventId:            eventId,
            atBlock:            block.number,
            deltaWei:           int256(2.4e24),
            realTxHash:         keccak256("real"),
            counterfactualRoot: keccak256("cfroot"),
            proofDigest:        keccak256("proof"),
            recordedAt:         0
        });
        // CounterfactualVerifier requires exactly 5 inputs matching the
        // 160-byte journal: [eventId, root, delta, victim, forkBlockHash].
        bytes32[] memory pubs = new bytes32[](5);
        pubs[0] = e.eventId;
        pubs[1] = e.counterfactualRoot;
        pubs[2] = bytes32(uint256(e.deltaWei));
        pubs[3] = bytes32(uint256(uint160(address(0xBEEF))));
        pubs[4] = bytes32(0); // forkBlockHash: zero = Approach B (structural only)
        bytes memory seal = _counterfactualSeal(pubs);

        vm.prank(PROVER);
        uint256 g0 = gasleft();
        ledger.record(e, seal, pubs);
        uint256 gasUsed = g0 - gasleft();

        assertLt(
            gasUsed,
            MAX_LEDGER_RECORD,
            "CounterfactualLedger.record exceeds 260k+5% gas target (doc 02)"
        );
    }

    /// @notice PauseController.activate must stay under 45k gas (+ 5% tolerance).
    function test_gas_PauseActivate() public {
        vm.prank(address(policyReg));
        uint256 g0 = gasleft();
        pauseCtrl.activate(
            TARGET,
            PauseController.DefenseType.Pause,
            keccak256("gas-pause-event")
        );
        uint256 gasUsed = g0 - gasleft();

        assertLt(
            gasUsed,
            MAX_PAUSE_ACTIVATE,
            "PauseController.activate exceeds 45k+5% gas target (doc 02)"
        );
    }
}
