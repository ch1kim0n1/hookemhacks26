// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {ThreatRegistry} from "../../src/ThreatRegistry.sol";

contract ThreatRegistryFuzzTest is Test {
    ThreatRegistry reg;
    address constant OP = address(0xC3);

    function setUp() public {
        reg = new ThreatRegistry(OP);
    }

    function _sig(bytes32 h, uint16 confidence) internal pure returns (ThreatRegistry.Signature memory) {
        return ThreatRegistry.Signature({
            signatureHash: h,
            defensePrimitive: keccak256("pause"),
            confidence: confidence,
            derivationProof: keccak256("proof"),
            publishedAt: 0
        });
    }

    // Fuzz: any non-zero hash with valid confidence (<=10000) must publish
    function testFuzz_Publish_AcceptsValidSignature(bytes32 h, uint16 confidence) public {
        vm.assume(h != bytes32(0));
        vm.assume(confidence <= 10000);

        vm.prank(OP);
        reg.publish(_sig(h, confidence));
        assertTrue(reg.isThreat(h));
    }

    // Fuzz: confidence > 10000 must revert
    function testFuzz_Publish_RejectsHighConfidence(bytes32 h, uint16 confidence) public {
        vm.assume(h != bytes32(0));
        vm.assume(confidence > 10000);

        vm.prank(OP);
        vm.expectRevert(bytes("ThreatRegistry: bad confidence"));
        reg.publish(_sig(h, confidence));
    }

    // Fuzz: non-operator callers always fail
    function testFuzz_Publish_OnlyOperator(address caller, bytes32 h) public {
        vm.assume(caller != OP);
        vm.assume(h != bytes32(0));

        vm.prank(caller);
        vm.expectRevert(bytes("ThreatRegistry: not operator"));
        reg.publish(_sig(h, 9000));
    }

    // Fuzz: TTL expiry monotonicity — a signature expires IFF
    //       block.timestamp > publishedAt + ttl
    function testFuzz_Expiry_MatchesTtl(bytes32 h, uint32 ttl, uint32 warpSeconds) public {
        vm.assume(h != bytes32(0));
        vm.assume(ttl > 0);

        vm.prank(OP);
        reg.setTtl(ttl);

        vm.prank(OP);
        reg.publish(_sig(h, 9000));
        uint256 publishedAt = block.timestamp;

        vm.warp(publishedAt + warpSeconds);
        bool expected = warpSeconds <= ttl;
        assertEq(reg.isThreat(h), expected);
    }

    // Fuzz: duplicate publish always reverts
    function testFuzz_Publish_NoDuplicates(bytes32 h) public {
        vm.assume(h != bytes32(0));

        vm.prank(OP);
        reg.publish(_sig(h, 9000));

        vm.prank(OP);
        vm.expectRevert(bytes("ThreatRegistry: exists"));
        reg.publish(_sig(h, 9000));
    }
}

// =================================================================
// Invariant: signatureHashes array and signatures mapping stay in sync
// =================================================================

contract ThreatRegistryHandler is Test {
    ThreatRegistry public reg;
    address public op;
    bytes32[] public published;
    mapping(bytes32 => bool) public seen;

    constructor(ThreatRegistry _reg, address _op) {
        reg = _reg;
        op = _op;
    }

    function publish(uint256 seed, uint16 confidence) external {
        confidence = uint16(bound(confidence, 0, 10000));
        bytes32 h = keccak256(abi.encode(seed, published.length));
        if (seen[h]) return;

        vm.prank(op);
        reg.publish(ThreatRegistry.Signature({
            signatureHash: h,
            defensePrimitive: keccak256("pause"),
            confidence: confidence,
            derivationProof: keccak256("p"),
            publishedAt: 0
        }));
        seen[h] = true;
        published.push(h);
    }

    function warp(uint256 seconds_) external {
        seconds_ = bound(seconds_, 0, 30 days);
        vm.warp(block.timestamp + seconds_);
    }

    function publishedLength() external view returns (uint256) {
        return published.length;
    }
}

contract ThreatRegistryInvariantTest is StdInvariant, Test {
    ThreatRegistry reg;
    ThreatRegistryHandler handler;
    address constant OP = address(0xC3);

    function setUp() public {
        reg = new ThreatRegistry(OP);
        handler = new ThreatRegistryHandler(reg, OP);
        targetContract(address(handler));
    }

    /// @dev Every hash in the handler's list is retrievable via the registry.
    function invariant_AllPublishedAreStored() public {
        uint256 n = handler.publishedLength();
        for (uint256 i = 0; i < n; i++) {
            bytes32 h = handler.published(i);
            ThreatRegistry.Signature memory s = reg.get(h);
            assertEq(s.signatureHash, h, "published hash not stored");
        }
    }

    /// @dev activeCount never exceeds total published.
    function invariant_ActiveCountBounded() public {
        assertLe(reg.activeCount(), handler.publishedLength());
    }

    /// @dev signatureHashes array length equals number of unique publishes.
    function invariant_ArrayLengthMatches() public {
        // Access via getAll (returns the internal array)
        bytes32[] memory all = reg.getAll();
        assertEq(all.length, handler.publishedLength());
    }
}
