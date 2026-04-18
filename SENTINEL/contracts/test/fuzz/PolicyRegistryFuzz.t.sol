// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyRegistry} from "../../src/PolicyRegistry.sol";
import {MockZKFixture} from "../helpers/MockZKFixture.sol";

/// @notice Target contract for the registry to `call` during execute.
contract CallSink {
    uint256 public pokes;
    bytes public lastData;

    function poke() external {
        pokes += 1;
        lastData = msg.data;
    }

    function rejectAll() external pure returns (bool) {
        revert("sink: reject");
    }
}

/// @notice Property-based tests covering PolicyRegistry's critical
///         integrity checks: action binding, stale policy rejection,
///         proof verification, and caller authorization.
contract PolicyRegistryFuzzTest is MockZKFixture {
    PolicyRegistry reg;
    CallSink sink;

    address constant AGENT = address(0xA1);
    bytes32 constant POLICY_HASH = keccak256("policy-v1");

    function setUp() public {
        _deployMockZK();
        reg = new PolicyRegistry(address(policyVerifier), address(learningVerifier));
        reg.initialize(POLICY_HASH, AGENT);
        sink = new CallSink();
    }

    function _buildAction(address target, bytes memory action, bytes32 eventId)
        internal
        view
        returns (bytes memory proof, bytes32[] memory publicInputs)
    {
        bytes32 actionHash = keccak256(abi.encodePacked(target, action));
        publicInputs = new bytes32[](3);
        publicInputs[0] = actionHash;
        publicInputs[1] = reg.currentPolicyHash();
        publicInputs[2] = eventId;
        proof = _policySeal(publicInputs);
    }

    // Fuzz: with a valid proof + policy, any caller identity is AGENT must succeed
    function testFuzz_VerifyAndExecute_HappyPath(bytes32 eventId) public {
        bytes memory action = abi.encodeWithSelector(CallSink.poke.selector);
        (bytes memory proof, bytes32[] memory publicInputs) = _buildAction(address(sink), action, eventId);

        vm.prank(AGENT);
        bool ok = reg.verifyAndExecute(address(sink), action, proof, publicInputs);
        assertTrue(ok);
        assertEq(sink.pokes(), 1);
    }

    // Fuzz: any caller other than AGENT reverts
    function testFuzz_VerifyAndExecute_OnlyAgent(address attacker, bytes32 eventId) public {
        vm.assume(attacker != AGENT);
        bytes memory action = abi.encodeWithSelector(CallSink.poke.selector);
        (bytes memory proof, bytes32[] memory publicInputs) = _buildAction(address(sink), action, eventId);

        vm.prank(attacker);
        vm.expectRevert(bytes("PolicyRegistry: not agent"));
        reg.verifyAndExecute(address(sink), action, proof, publicInputs);
    }

    // Fuzz: if the committed actionHash doesn't match target+action, revert
    function testFuzz_VerifyAndExecute_ActionHashBinding(bytes32 fakeHash, bytes32 eventId) public {
        bytes memory action = abi.encodeWithSelector(CallSink.poke.selector);
        bytes32 realHash = keccak256(abi.encodePacked(address(sink), action));
        vm.assume(fakeHash != realHash);

        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = fakeHash;
        publicInputs[1] = reg.currentPolicyHash();
        publicInputs[2] = eventId;
        bytes memory proof = _policySeal(publicInputs);

        vm.prank(AGENT);
        vm.expectRevert(bytes("PolicyRegistry: action mismatch"));
        reg.verifyAndExecute(address(sink), action, proof, publicInputs);
    }

    // Fuzz: stale policy hash (any value != currentPolicyHash) reverts
    function testFuzz_VerifyAndExecute_StalePolicy(bytes32 stalePolicy, bytes32 eventId) public {
        vm.assume(stalePolicy != POLICY_HASH);
        bytes memory action = abi.encodeWithSelector(CallSink.poke.selector);
        bytes32 actionHash = keccak256(abi.encodePacked(address(sink), action));

        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = actionHash;
        publicInputs[1] = stalePolicy;
        publicInputs[2] = eventId;
        bytes memory proof = _policySeal(publicInputs);

        vm.prank(AGENT);
        vm.expectRevert(bytes("PolicyRegistry: stale policy"));
        reg.verifyAndExecute(address(sink), action, proof, publicInputs);
    }

    // Fuzz: if target call reverts, the whole tx reverts
    function testFuzz_VerifyAndExecute_TargetRevertsPropagates(bytes32 eventId) public {
        bytes memory action = abi.encodeWithSelector(CallSink.rejectAll.selector);
        (bytes memory proof, bytes32[] memory publicInputs) = _buildAction(address(sink), action, eventId);

        vm.prank(AGENT);
        vm.expectRevert(bytes("PolicyRegistry: target call failed"));
        reg.verifyAndExecute(address(sink), action, proof, publicInputs);
    }
}
