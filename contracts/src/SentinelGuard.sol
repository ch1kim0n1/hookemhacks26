// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PauseController} from "./PauseController.sol";
import {ClawGuardRegistry} from "./ClawGuardRegistry.sol";

/// @title SentinelGuard
/// @notice Read-only integration surface. Protected protocols call
///         `isAllowed(caller, selector)` through the `sentinelProtected`
///         modifier; it returns `false` when a Pause defense is active,
///         blocking the underlying function.
contract SentinelGuard {
    PauseController public immutable pauseController;
    ClawGuardRegistry public threatRegistry;
    address public owner;

    constructor(address _pauseController) {
        require(_pauseController != address(0), "SentinelGuard: zero controller");
        pauseController = PauseController(_pauseController);
        owner = msg.sender;
    }

    function setThreatRegistry(address _registry) external {
        require(msg.sender == owner, "SentinelGuard: not owner");
        threatRegistry = ClawGuardRegistry(_registry);
    }

    /// @notice Phase 2: allow unless the caller's contract has an active
    ///         Pause defense. `caller` here is the protected-protocol
    ///         address (the contract wearing the `sentinelProtected`
    ///         modifier), not `msg.sender`. Phase 3 adds protocol-
    ///         specific selector allowlists.
    function isAllowed(address caller, bytes4 selector) external view returns (bool) {
        selector; // unused until Phase 3 per-selector allowlists
        (
            PauseController.DefenseType defenseType,
            ,
            ,
            ,
            bool active
        ) = pauseController.activeDefense(caller);

        if (!active) return true;
        if (defenseType == PauseController.DefenseType.Pause) return false;
        // Other defense types don't halt reads in Phase 2.
        return true;
    }

    /// @notice Enhanced isAllowed that also checks threat signatures.
    ///         If a transaction's selector+target combo matches a known threat,
    ///         block it pre-emptively.
    function isAllowedEnhanced(
        address caller,
        bytes4 selector,
        bytes32 txSignatureHash
    ) external view returns (bool) {
        selector; // unused until Phase 3 per-selector allowlists
        // First check existing pause logic
        (
            PauseController.DefenseType defenseType,
            ,
            ,
            ,
            bool active
        ) = pauseController.activeDefense(caller);
        if (active && defenseType == PauseController.DefenseType.Pause) return false;

        // Then check threat registry (if configured)
        if (address(threatRegistry) != address(0) && txSignatureHash != bytes32(0)) {
            if (threatRegistry.isThreat(txSignatureHash)) return false;
        }

        return true;
    }
}
