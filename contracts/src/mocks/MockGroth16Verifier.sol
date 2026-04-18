// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Stand-in Groth16 verifier for local tests and devnets (always returns true).
/// Production should use a real verifier contract with pairing checks.
contract MockGroth16Verifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}
