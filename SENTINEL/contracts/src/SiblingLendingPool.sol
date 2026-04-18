// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SentinelGuard} from "./SentinelGuard.sol";

/// @title SiblingLendingPool
/// @notice Minimal peer-protocol placeholder deployed alongside the
///         main `VictimLendingPool` for the immunity-map demo. Holds
///         a distinct on-chain address (so the federation-propagation
///         story is backed by actual state, not frontend animation)
///         and a `name` label for UI binding.
/// @dev    This contract is *not* the vulnerable pool — it has no
///         borrow/deposit surface. Its only job is to exist, report
///         `sentinel.isAllowed(this, msg.sig)`, and be paused
///         independently when the ThreatRegistry propagates a
///         signature. Gas-cheap by design.
contract SiblingLendingPool {
    SentinelGuard public immutable sentinel;
    string public name;

    event Probed(address indexed caller, bytes4 selector, bool allowed);

    constructor(address _sentinel, string memory _name) {
        require(_sentinel != address(0), "SiblingLendingPool: zero sentinel");
        require(bytes(_name).length > 0, "SiblingLendingPool: empty name");
        sentinel = SentinelGuard(_sentinel);
        name = _name;
    }

    /// @notice Returns whether this protocol would currently accept a
    ///         call with `selector`. The frontend polls this to colour
    ///         each sibling node green/red on the immunity map.
    function isAllowed(bytes4 selector) external view returns (bool) {
        return sentinel.isAllowed(address(this), selector);
    }

    /// @notice State-mutating probe used by integration tests to prove
    ///         the `sentinelProtected` revert path works on this sibling
    ///         independently of the main `VictimLendingPool`.
    function probe(bytes4 selector) external returns (bool allowed) {
        allowed = sentinel.isAllowed(address(this), selector);
        emit Probed(msg.sender, selector, allowed);
    }
}
