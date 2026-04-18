// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title PauseController
/// @notice Emergency pause primitive. Only the PolicyRegistry (acting
///         on a verified defense action) can activate. Governance can
///         deactivate.
/// @dev    MVP scope per doc 09 is pause only (other DefenseType values
///         are declared but unused in Phase 2).
contract PauseController {
    enum DefenseType { None, Pause, Quarantine, RateLimit, CircuitBreaker, Unwind }

    struct Defense {
        DefenseType defenseType;
        address target;
        bytes32 eventId;
        uint256 activatedAt;
        bool active;
    }

    mapping(address => Defense) public activeDefense;
    address public policyRegistry;
    address public quarantineVault;
    address public governance;

    event DefenseActivated(
        address indexed target,
        DefenseType defenseType,
        bytes32 indexed eventId,
        uint256 activatedAt
    );
    event DefenseDeactivated(address indexed target, bytes32 indexed eventId);

    modifier onlyPolicyRegistry() {
        require(msg.sender == policyRegistry, "PauseController: not policy registry");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, "PauseController: not governance");
        _;
    }

    constructor(address _policyRegistry, address _quarantineVault) {
        require(_policyRegistry != address(0), "PauseController: zero registry");
        require(_quarantineVault != address(0), "PauseController: zero vault");
        policyRegistry = _policyRegistry;
        quarantineVault = _quarantineVault;
        governance = msg.sender;
    }

    /// @notice Activate a defense on the given target. Only callable by
    ///         PolicyRegistry after a successful policy-proof verify.
    function activate(
        address target,
        DefenseType t,
        bytes32 eventId
    ) external onlyPolicyRegistry {
        require(target != address(0), "PauseController: zero target");
        require(t != DefenseType.None, "PauseController: bad type");
        require(eventId != bytes32(0), "PauseController: empty eventId");
        require(!activeDefense[target].active, "PauseController: already active");

        activeDefense[target] = Defense({
            defenseType: t,
            target: target,
            eventId: eventId,
            activatedAt: block.timestamp,
            active: true
        });

        emit DefenseActivated(target, t, eventId, block.timestamp);
    }

    /// @notice Clear an active defense. Governance-only.
    function deactivate(address target) external onlyGovernance {
        Defense storage d = activeDefense[target];
        require(d.active, "PauseController: not active");
        bytes32 eventId = d.eventId;
        d.active = false;
        emit DefenseDeactivated(target, eventId);
    }

    /// @notice Convenience read: is `target` currently paused?
    function isPaused(address target) external view returns (bool) {
        Defense storage d = activeDefense[target];
        return d.active && d.defenseType == DefenseType.Pause;
    }
}
