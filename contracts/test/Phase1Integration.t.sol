// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/ClawGuardRegistry.sol";
import "../src/DefenseProtocol.sol";

contract MockVerifierOk is IVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure override returns (bool) {
        return true;
    }
}

/// @notice End-to-end smoke: threat registry + defense policy update (local Anvil / CI).
contract Phase1IntegrationTest is Test {
    function test_registry_attack_hash_and_defense_update_smoke() public {
        ClawGuardRegistry reg = new ClawGuardRegistry();
        bytes32 pattern = keccak256("injection pattern");
        reg.publishAttack(pattern, "instruction_override", "sample");
        assertTrue(reg.isKnownAttack(pattern));
        assertTrue(reg.isThreat(pattern));

        MockVerifierOk mv = new MockVerifierOk();
        DefenseProtocol dp = new DefenseProtocol(address(mv), address(mv));
        address agent = address(0xA11CE);
        dp.initialize(keccak256("defense0"), agent);

        bytes32 nextHash = keccak256("defense1");
        bytes32[] memory inputs = new bytes32[](2);
        inputs[0] = dp.currentPolicyHash();
        inputs[1] = nextHash;
        dp.publishDefenseUpdate(nextHash, hex"01", inputs);
        assertEq(dp.policyVersion(), 2);
        assertEq(dp.currentPolicyHash(), nextHash);
    }
}
