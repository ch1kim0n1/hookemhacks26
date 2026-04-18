// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ModelRegistry} from "../../src/ModelRegistry.sol";
import {FederationVerifier} from "../../src/FederationVerifier.sol";

contract ModelRegistryTest is Test {
    ModelRegistry reg;

    address constant ADMIN  = address(0xA001);
    address constant ALPHA  = address(0xA1FA);
    address constant BETA   = address(0xB17A);
    address constant GAMMA  = address(0xC39A);

    bytes32 constant HASH_A = keccak256("alpha-model-v1");
    bytes32 constant HASH_A2 = keccak256("alpha-model-v2");
    bytes32 constant HASH_B = keccak256("beta-model-v1");

    function setUp() public {
        reg = new ModelRegistry(ADMIN);
    }

    // ── construction ──────────────────────────────────────────────────

    function test_Constructor_RejectsZeroAdmin() public {
        vm.expectRevert(bytes("ModelRegistry: zero admin"));
        new ModelRegistry(address(0));
    }

    function test_Constructor_SetsAdmin() public {
        assertEq(reg.admin(), ADMIN);
    }

    // ── registerModel ─────────────────────────────────────────────────

    function test_Register_SetsCurrentModel() public {
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A, bytes("meta-a"));

        (bytes32 h, string memory id, uint256 ts, bytes memory meta) = reg.modelOf(ALPHA);
        assertEq(h, HASH_A);
        assertEq(id, "alpha");
        assertGt(ts, 0);
        assertEq(meta, bytes("meta-a"));
    }

    function test_Register_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit ModelRegistry.ModelRegistered(ALPHA, HASH_A, "alpha", bytes("meta-a"));
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A, bytes("meta-a"));
    }

    function test_Register_RejectsEmptyId() public {
        vm.prank(ALPHA);
        vm.expectRevert(bytes("ModelRegistry: empty operatorId"));
        reg.registerModel("", HASH_A, bytes(""));
    }

    function test_Register_RejectsEmptyHash() public {
        vm.prank(ALPHA);
        vm.expectRevert(bytes("ModelRegistry: empty hash"));
        reg.registerModel("alpha", bytes32(0), bytes(""));
    }

    function test_Register_RejectsOverlongId() public {
        vm.prank(ALPHA);
        vm.expectRevert(bytes("ModelRegistry: operatorId too long"));
        reg.registerModel("thisoperatoridisdefinitelymorethan32chars", HASH_A, bytes(""));
    }

    function test_Register_SameHashIsNoOp() public {
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A, bytes("meta"));
        (, , uint256 ts1, ) = reg.modelOf(ALPHA);

        vm.warp(block.timestamp + 100);
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A, bytes("different-meta"));  // no-op
        (bytes32 h, , uint256 ts2, bytes memory meta) = reg.modelOf(ALPHA);

        assertEq(h, HASH_A);
        assertEq(ts2, ts1, "timestamp must not change on no-op");
        assertEq(meta, bytes("meta"), "metadata must not change on no-op");
    }

    function test_Register_ReRegister_UpdatesHash() public {
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A, bytes("v1"));

        vm.warp(block.timestamp + 100);
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A2, bytes("v2"));

        (bytes32 h, , , bytes memory meta) = reg.modelOf(ALPHA);
        assertEq(h, HASH_A2);
        assertEq(meta, bytes("v2"));

        assertFalse(reg.isRegistered(HASH_A), "old hash should no longer be current");
        assertTrue(reg.isRegistered(HASH_A2));
    }

    function test_IsRegistered_UnknownReturnsFalse() public {
        assertFalse(reg.isRegistered(HASH_A));
    }

    function test_IsRegistered_AfterRegistrationReturnsTrue() public {
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A, bytes(""));
        assertTrue(reg.isRegistered(HASH_A));
    }

    function test_AreAllRegistered_AllTrue() public {
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A, bytes(""));
        vm.prank(BETA);
        reg.registerModel("beta", HASH_B, bytes(""));

        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = HASH_A;
        hashes[1] = HASH_B;
        assertTrue(reg.areAllRegistered(hashes));
    }

    function test_AreAllRegistered_OneMissing_ReturnsFalse() public {
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A, bytes(""));

        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = HASH_A;
        hashes[1] = HASH_B;
        assertFalse(reg.areAllRegistered(hashes));
    }

    function test_OperatorCount_StartsAtZero() public {
        assertEq(reg.operatorCount(), 0);
    }

    function test_OperatorCount_TracksUniqueOperators() public {
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A, bytes(""));
        vm.prank(BETA);
        reg.registerModel("beta", HASH_B, bytes(""));
        assertEq(reg.operatorCount(), 2);

        // Re-registering doesn't bump count.
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A2, bytes(""));
        assertEq(reg.operatorCount(), 2);
    }

    function test_AllOperators_ReturnsRegisteredAddresses() public {
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A, bytes(""));
        vm.prank(BETA);
        reg.registerModel("beta", HASH_B, bytes(""));

        address[] memory ops = reg.allOperators();
        assertEq(ops.length, 2);
        assertEq(ops[0], ALPHA);
        assertEq(ops[1], BETA);
    }

    // ── admin ─────────────────────────────────────────────────────────

    function test_SetAdmin_OnlyAdmin() public {
        vm.prank(ALPHA);
        vm.expectRevert(bytes("ModelRegistry: not admin"));
        reg.setAdmin(ALPHA);
    }

    function test_SetAdmin_ChangesAdmin() public {
        vm.prank(ADMIN);
        reg.setAdmin(ALPHA);
        assertEq(reg.admin(), ALPHA);
    }
}


contract FederationVerifierTest is Test {
    ModelRegistry reg;
    FederationVerifier ver;

    address constant ADMIN  = address(0xA001);
    address constant ALPHA  = address(0xA1FA);
    address constant BETA   = address(0xB17A);
    address constant GAMMA  = address(0xC39A);

    bytes32 constant HASH_A = keccak256("alpha-model-v1");
    bytes32 constant HASH_B = keccak256("beta-model-v1");
    bytes32 constant HASH_C = keccak256("gamma-model-v1");
    bytes32 constant HASH_X = keccak256("rogue-model");

    bytes32 constant EVENT_ID = keccak256("event-1");
    address constant ATTACKER = address(0xDEAD);

    function setUp() public {
        reg = new ModelRegistry(ADMIN);
        // K=2, N=3, minConfidence=7500bp
        ver = new FederationVerifier(address(reg), ADMIN, 2, 3, 7500);

        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A, bytes("a"));
        vm.prank(BETA);
        reg.registerModel("beta", HASH_B, bytes("b"));
        vm.prank(GAMMA);
        reg.registerModel("gamma", HASH_C, bytes("c"));
    }

    function _att(address op, bytes32 h, uint16 conf) internal pure returns (FederationVerifier.Attestation memory) {
        return FederationVerifier.Attestation({ operator: op, modelHash: h, confidence: conf });
    }

    function _bundle3(
        bytes32 id,
        uint16 agg,
        FederationVerifier.Attestation memory a1,
        FederationVerifier.Attestation memory a2,
        FederationVerifier.Attestation memory a3
    ) internal pure returns (FederationVerifier.ConsensusBundle memory) {
        FederationVerifier.Attestation[] memory atts = new FederationVerifier.Attestation[](3);
        atts[0] = a1;
        atts[1] = a2;
        atts[2] = a3;
        return FederationVerifier.ConsensusBundle({
            eventId: id,
            attackerAddress: ATTACKER,
            aggregatedConfidence: agg,
            attestations: atts
        });
    }

    function _bundle2(
        bytes32 id,
        uint16 agg,
        FederationVerifier.Attestation memory a1,
        FederationVerifier.Attestation memory a2
    ) internal pure returns (FederationVerifier.ConsensusBundle memory) {
        FederationVerifier.Attestation[] memory atts = new FederationVerifier.Attestation[](2);
        atts[0] = a1;
        atts[1] = a2;
        return FederationVerifier.ConsensusBundle({
            eventId: id,
            attackerAddress: ATTACKER,
            aggregatedConfidence: agg,
            attestations: atts
        });
    }

    // ── happy path ────────────────────────────────────────────────────

    function test_Accept_FullAgreement() public {
        FederationVerifier.ConsensusBundle memory b = _bundle3(
            EVENT_ID, 9400,
            _att(ALPHA, HASH_A, 9200),
            _att(BETA,  HASH_B, 9500),
            _att(GAMMA, HASH_C, 9500)
        );
        bool ok = ver.submitBundle(b);
        assertTrue(ok);
        assertTrue(ver.isAccepted(EVENT_ID));
    }

    function test_Accept_TwoOfThree() public {
        FederationVerifier.ConsensusBundle memory b = _bundle2(
            EVENT_ID, 9300,
            _att(ALPHA, HASH_A, 9200),
            _att(BETA,  HASH_B, 9400)
        );
        bool ok = ver.submitBundle(b);
        assertTrue(ok);
        assertTrue(ver.isAccepted(EVENT_ID));
    }

    // ── rejections ────────────────────────────────────────────────────

    function test_Reject_OneOfThree_BelowThreshold() public {
        FederationVerifier.Attestation[] memory atts = new FederationVerifier.Attestation[](1);
        atts[0] = _att(ALPHA, HASH_A, 9200);
        FederationVerifier.ConsensusBundle memory b = FederationVerifier.ConsensusBundle({
            eventId: EVENT_ID,
            attackerAddress: ATTACKER,
            aggregatedConfidence: 9200,
            attestations: atts
        });
        bool ok = ver.submitBundle(b);
        assertFalse(ok);
        assertFalse(ver.isAccepted(EVENT_ID));
    }

    function test_Reject_BelowMinConfidence() public {
        FederationVerifier.ConsensusBundle memory b = _bundle2(
            EVENT_ID, 5000,
            _att(ALPHA, HASH_A, 5000),
            _att(BETA,  HASH_B, 5000)
        );
        bool ok = ver.submitBundle(b);
        assertFalse(ok);
    }

    function test_Reject_UnregisteredModel() public {
        FederationVerifier.ConsensusBundle memory b = _bundle2(
            EVENT_ID, 9300,
            _att(ALPHA, HASH_X, 9200),   // HASH_X was never registered
            _att(BETA,  HASH_B, 9400)
        );
        bool ok = ver.submitBundle(b);
        assertFalse(ok);
    }

    function test_Reject_MismatchedOperatorAndHash() public {
        // ALPHA is registered to HASH_A, not HASH_B.
        FederationVerifier.ConsensusBundle memory b = _bundle2(
            EVENT_ID, 9300,
            _att(ALPHA, HASH_B, 9200),
            _att(BETA,  HASH_B, 9400)
        );
        bool ok = ver.submitBundle(b);
        assertFalse(ok);
    }

    function test_Reject_DuplicateOperators() public {
        // Same operator attesting twice shouldn't clear K=2.
        FederationVerifier.ConsensusBundle memory b = _bundle2(
            EVENT_ID, 9300,
            _att(ALPHA, HASH_A, 9200),
            _att(ALPHA, HASH_A, 9400)
        );
        bool ok = ver.submitBundle(b);
        assertFalse(ok);
    }

    function test_Reject_DuplicateEventId() public {
        FederationVerifier.ConsensusBundle memory b = _bundle2(
            EVENT_ID, 9300,
            _att(ALPHA, HASH_A, 9200),
            _att(BETA,  HASH_B, 9400)
        );
        assertTrue(ver.submitBundle(b));

        // Second submission with same eventId should revert.
        vm.expectRevert(bytes("FederationVerifier: duplicate"));
        ver.submitBundle(b);
    }

    function test_Reject_ZeroEventId() public {
        FederationVerifier.ConsensusBundle memory b = _bundle2(
            bytes32(0), 9300,
            _att(ALPHA, HASH_A, 9200),
            _att(BETA,  HASH_B, 9400)
        );
        vm.expectRevert(bytes("FederationVerifier: zero eventId"));
        ver.submitBundle(b);
    }

    // ── model rotation ────────────────────────────────────────────────

    function test_Reject_OldHashAfterRotation() public {
        // Alpha rotates to a new model; bundle with OLD hash should fail.
        bytes32 HASH_A_V2 = keccak256("alpha-model-v2");
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A_V2, bytes("v2"));

        FederationVerifier.ConsensusBundle memory b = _bundle2(
            EVENT_ID, 9300,
            _att(ALPHA, HASH_A, 9200),   // stale hash
            _att(BETA,  HASH_B, 9400)
        );
        bool ok = ver.submitBundle(b);
        assertFalse(ok);
    }

    function test_Accept_AfterRotationWithNewHash() public {
        bytes32 HASH_A_V2 = keccak256("alpha-model-v2");
        vm.prank(ALPHA);
        reg.registerModel("alpha", HASH_A_V2, bytes("v2"));

        FederationVerifier.ConsensusBundle memory b = _bundle2(
            EVENT_ID, 9300,
            _att(ALPHA, HASH_A_V2, 9200),
            _att(BETA,  HASH_B,    9400)
        );
        assertTrue(ver.submitBundle(b));
    }

    // ── admin / thresholds ────────────────────────────────────────────

    function test_SetThresholds_OnlyAdmin() public {
        vm.prank(ALPHA);
        vm.expectRevert(bytes("FederationVerifier: not admin"));
        ver.setThresholds(3, 3, 9000);
    }

    function test_SetThresholds_ChangesBehaviour() public {
        // Tighten to 3-of-3.
        vm.prank(ADMIN);
        ver.setThresholds(3, 3, 7500);

        // 2-of-3 now rejected.
        FederationVerifier.ConsensusBundle memory b = _bundle2(
            EVENT_ID, 9300,
            _att(ALPHA, HASH_A, 9200),
            _att(BETA,  HASH_B, 9400)
        );
        assertFalse(ver.submitBundle(b));
    }

    function test_SetThresholds_RejectsBadK() public {
        vm.prank(ADMIN);
        vm.expectRevert(bytes("FederationVerifier: bad thresholds"));
        ver.setThresholds(0, 3, 7500);

        vm.prank(ADMIN);
        vm.expectRevert(bytes("FederationVerifier: bad thresholds"));
        ver.setThresholds(4, 3, 7500);
    }

    // ── constructor ───────────────────────────────────────────────────

    function test_Constructor_RejectsZeroRegistry() public {
        vm.expectRevert(bytes("FederationVerifier: zero registry"));
        new FederationVerifier(address(0), ADMIN, 2, 3, 7500);
    }

    function test_Constructor_RejectsBadThresholds() public {
        vm.expectRevert(bytes("FederationVerifier: bad thresholds"));
        new FederationVerifier(address(reg), ADMIN, 4, 3, 7500);
    }

    function test_Constructor_SetsInitialState() public {
        assertEq(ver.thresholdK(), 2);
        assertEq(ver.thresholdN(), 3);
        assertEq(ver.minConfidence(), 7500);
        assertEq(ver.admin(), ADMIN);
        assertEq(address(ver.registry()), address(reg));
    }
}
