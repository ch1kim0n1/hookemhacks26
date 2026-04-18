// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ModelRegistry — minimal operator model hash registry for FederationVerifier
/// @notice Stubs operator → modelHash for consensus attestation checks.
contract ModelRegistry {
    mapping(address => bytes32) private _modelHash;

    event ModelRegistered(address indexed operator, bytes32 modelHash);

    function registerModel(bytes32 modelHash) external {
        _modelHash[msg.sender] = modelHash;
        emit ModelRegistered(msg.sender, modelHash);
    }

    /// @dev Shape matches FederationVerifier: (currentHash, a, b, c)
    function modelOf(address operator)
        external
        view
        returns (bytes32 currentHash, uint256 a, uint256 b, uint256 c)
    {
        currentHash = _modelHash[operator];
        return (currentHash, 0, 0, 0);
    }
}
