// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {ThreatRegistry} from "../../src/ThreatRegistry.sol";
import {SentinelGuard} from "../../src/SentinelGuard.sol";
import {PauseController} from "../../src/PauseController.sol";
import {PolicyRegistry} from "../../src/PolicyRegistry.sol";
import {QuarantineVault} from "../../src/QuarantineVault.sol";
import {MockZKFixture} from "../helpers/MockZKFixture.sol";

contract ThreatRegistryExtendedTest is Test {
    ThreatRegistry reg;
    address constant OP = address(0xC3);
    address constant EVE = address(0xEEE);

    bytes32 constant HASH_A = keccak256("threat-a");
    bytes32 constant HASH_B = keccak256("threat-b");
    bytes32 constant HASH_UNKNOWN = keccak256("unknown");

    function setUp() public {
        reg = new ThreatRegistry(OP);
    }

    function _publishSig(bytes32 h) internal {
        ThreatRegistry.Signature memory s = ThreatRegistry.Signature({
            signatureHash: h,
            defensePrimitive: keccak256("pause"),
            confidence: 9000,
            derivationProof: keccak256("proof"),
            publishedAt: 0
        });
        vm.prank(OP);
        reg.publish(s);
    }

    // --- isThreat ---

    function test_IsThreat_FreshSignature_ReturnsTrue() public {
        _publishSig(HASH_A);
        assertTrue(reg.isThreat(HASH_A));
    }

    function test_IsThreat_ExpiredSignature_ReturnsFalse() public {
        _publishSig(HASH_A);
        // Warp past default TTL of 7 days (604800 seconds)
        vm.warp(block.timestamp + 604801);
        assertFalse(reg.isThreat(HASH_A));
    }

    function test_IsThreat_UnknownHash_ReturnsFalse() public {
        assertFalse(reg.isThreat(HASH_UNKNOWN));
    }

    function test_IsThreat_ExactlyAtExpiry_ReturnsFalse() public {
        _publishSig(HASH_A);
        uint256 publishedAt = reg.get(HASH_A).publishedAt;
        vm.warp(publishedAt + reg.ttlSeconds() + 1);
        assertFalse(reg.isThreat(HASH_A));
    }

    function test_IsThreat_JustBeforeExpiry_ReturnsTrue() public {
        _publishSig(HASH_A);
        uint256 publishedAt = reg.get(HASH_A).publishedAt;
        vm.warp(publishedAt + reg.ttlSeconds());
        assertTrue(reg.isThreat(HASH_A));
    }

    // --- areThreat ---

    function test_AreThreat_BatchQuery() public {
        _publishSig(HASH_A);
        _publishSig(HASH_B);

        bytes32[] memory hashes = new bytes32[](3);
        hashes[0] = HASH_A;
        hashes[1] = HASH_B;
        hashes[2] = HASH_UNKNOWN;

        bool[] memory results = reg.areThreat(hashes);
        assertEq(results.length, 3);
        assertTrue(results[0],  "HASH_A should be a threat");
        assertTrue(results[1],  "HASH_B should be a threat");
        assertFalse(results[2], "HASH_UNKNOWN should not be a threat");
    }

    function test_AreThreat_BatchQuery_AfterExpiry() public {
        _publishSig(HASH_A);

        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = HASH_A;

        vm.warp(block.timestamp + 604801);
        bool[] memory results = reg.areThreat(hashes);
        assertFalse(results[0], "expired signature should not be a threat");
    }

    function test_AreThreat_EmptyArray() public {
        bytes32[] memory hashes = new bytes32[](0);
        bool[] memory results = reg.areThreat(hashes);
        assertEq(results.length, 0);
    }

    // --- activeCount ---

    function test_ActiveCount_NoSignatures() public {
        assertEq(reg.activeCount(), 0);
    }

    function test_ActiveCount_AllFresh() public {
        _publishSig(HASH_A);
        _publishSig(HASH_B);
        assertEq(reg.activeCount(), 2);
    }

    function test_ActiveCount_AfterExpiry() public {
        _publishSig(HASH_A);
        _publishSig(HASH_B);
        vm.warp(block.timestamp + 604801);
        assertEq(reg.activeCount(), 0);
    }

    function test_ActiveCount_MixedExpiry() public {
        _publishSig(HASH_A);
        vm.warp(block.timestamp + 604801); // HASH_A expires
        _publishSig(HASH_B);               // HASH_B is fresh
        assertEq(reg.activeCount(), 1);
    }

    // --- setTtl ---

    function test_SetTtl_OnlyOperator() public {
        vm.prank(EVE);
        vm.expectRevert(bytes("ThreatRegistry: not operator"));
        reg.setTtl(100);
    }

    function test_SetTtl_ChangesExpiry() public {
        _publishSig(HASH_A);

        vm.prank(OP);
        reg.setTtl(100); // 100 seconds

        vm.warp(block.timestamp + 101);
        assertFalse(reg.isThreat(HASH_A), "should be expired with short TTL");
    }

    function test_SetTtl_DefaultIs604800() public {
        assertEq(reg.ttlSeconds(), 604800);
    }
}

contract SentinelGuardEnhancedTest is MockZKFixture {
    PolicyRegistry policyReg;
    QuarantineVault vault;
    PauseController pc;
    SentinelGuard guard;
    ThreatRegistry threatReg;

    address constant TARGET = address(0xDEAD);
    address constant AGENT = address(0xA1);
    address constant OP = address(0xC3);

    bytes32 constant KNOWN_THREAT = keccak256("known-threat-sig");
    bytes32 constant UNKNOWN_SIG  = keccak256("unknown-sig");

    function setUp() public {
        _deployMockZK();
        policyReg = new PolicyRegistry(address(policyVerifier), address(learningVerifier));
        vault = new QuarantineVault();
        pc = new PauseController(address(policyReg), address(vault));
        vault.setPauseController(address(pc));
        guard = new SentinelGuard(address(pc));
        policyReg.initialize(keccak256("p"), AGENT);

        // Deploy and wire up ThreatRegistry
        threatReg = new ThreatRegistry(OP);
        guard.setThreatRegistry(address(threatReg));

        // Publish a known threat
        ThreatRegistry.Signature memory s = ThreatRegistry.Signature({
            signatureHash: KNOWN_THREAT,
            defensePrimitive: keccak256("pause"),
            confidence: 9500,
            derivationProof: keccak256("proof"),
            publishedAt: 0
        });
        vm.prank(OP);
        threatReg.publish(s);
    }

    // --- isAllowedEnhanced ---

    function test_IsAllowedEnhanced_BlocksKnownThreat() public {
        assertFalse(guard.isAllowedEnhanced(TARGET, bytes4(0x12345678), KNOWN_THREAT));
    }

    function test_IsAllowedEnhanced_AllowsUnknownSignature() public {
        assertTrue(guard.isAllowedEnhanced(TARGET, bytes4(0x12345678), UNKNOWN_SIG));
    }

    function test_IsAllowedEnhanced_AllowsZeroHash() public {
        // Zero hash means no threat check — should pass
        assertTrue(guard.isAllowedEnhanced(TARGET, bytes4(0x12345678), bytes32(0)));
    }

    function test_IsAllowedEnhanced_BlockedByPause_NoRegistry() public {
        vm.prank(address(policyReg));
        pc.activate(TARGET, PauseController.DefenseType.Pause, keccak256("e"));
        // Even with an unknown sig, Pause defense blocks it
        assertFalse(guard.isAllowedEnhanced(TARGET, bytes4(0x12345678), UNKNOWN_SIG));
    }

    function test_IsAllowedEnhanced_BlocksKnownThreat_EvenWithoutPause() public {
        assertFalse(pc.isPaused(TARGET)); // no pause active
        assertFalse(guard.isAllowedEnhanced(TARGET, bytes4(0x12345678), KNOWN_THREAT));
    }

    function test_IsAllowedEnhanced_AllowsExpiredThreat() public {
        // After TTL, expired threat should be allowed through
        vm.warp(block.timestamp + 604801);
        assertTrue(guard.isAllowedEnhanced(TARGET, bytes4(0x12345678), KNOWN_THREAT));
    }

    function test_IsAllowedEnhanced_NoRegistryConfigured() public {
        // Deploy a guard with no registry set
        SentinelGuard bareGuard = new SentinelGuard(address(pc));
        // Should still work — no registry means skip threat check
        assertTrue(bareGuard.isAllowedEnhanced(TARGET, bytes4(0x12345678), KNOWN_THREAT));
    }

    // --- setThreatRegistry access control ---

    function test_SetThreatRegistry_OnlyOwner() public {
        address eve = address(0xEEE);
        vm.prank(eve);
        vm.expectRevert(bytes("SentinelGuard: not owner"));
        guard.setThreatRegistry(address(threatReg));
    }

    // --- backward compatibility ---

    function test_IsAllowed_StillWorks_Unpaused() public {
        assertTrue(guard.isAllowed(TARGET, bytes4(0x12345678)));
    }

    function test_IsAllowed_StillWorks_Paused() public {
        vm.prank(address(policyReg));
        pc.activate(TARGET, PauseController.DefenseType.Pause, keccak256("e"));
        assertFalse(guard.isAllowed(TARGET, bytes4(0x12345678)));
    }

    function test_IsAllowed_IgnoresThreatRegistry() public {
        // isAllowed does NOT check threat registry — known threat sig is irrelevant
        // (no pause means allowed)
        assertTrue(guard.isAllowed(TARGET, bytes4(0x12345678)));
    }
}
