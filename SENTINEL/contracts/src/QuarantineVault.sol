// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title QuarantineVault
/// @notice Time-locked vault for quarantined funds. Only PauseController
///         can deposit; funds are released to the origin protocol after
///         `releaseTime = activatedAt + 72 hours`.
contract QuarantineVault {
    struct Quarantine {
        address originProtocol;
        uint256 amount;
        address token;
        uint256 releaseTime;
        bool released;
    }

    uint256 public constant RELEASE_DELAY = 72 hours;

    mapping(bytes32 => Quarantine) public quarantines;
    address public pauseController;
    address public owner;

    event Deposited(
        bytes32 indexed eventId,
        address indexed origin,
        address token,
        uint256 amount,
        uint256 releaseTime
    );
    event Released(bytes32 indexed eventId, address indexed origin, uint256 amount);

    modifier onlyPauseController() {
        require(msg.sender == pauseController, "QuarantineVault: not pause controller");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setPauseController(address _pauseController) external {
        require(msg.sender == owner, "QuarantineVault: not owner");
        require(pauseController == address(0), "QuarantineVault: already set");
        require(_pauseController != address(0), "QuarantineVault: zero addr");
        pauseController = _pauseController;
    }

    function deposit(
        bytes32 eventId,
        address token,
        uint256 amount,
        address origin
    ) external onlyPauseController {
        require(eventId != bytes32(0), "QuarantineVault: empty eventId");
        require(amount > 0, "QuarantineVault: zero amount");
        require(origin != address(0), "QuarantineVault: zero origin");
        require(quarantines[eventId].releaseTime == 0, "QuarantineVault: already exists");

        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "QuarantineVault: pull failed");

        uint256 releaseAt = block.timestamp + RELEASE_DELAY;
        quarantines[eventId] = Quarantine({
            originProtocol: origin,
            amount: amount,
            token: token,
            releaseTime: releaseAt,
            released: false
        });

        emit Deposited(eventId, origin, token, amount, releaseAt);
    }

    function release(bytes32 eventId) external {
        Quarantine storage q = quarantines[eventId];
        require(q.releaseTime != 0, "QuarantineVault: unknown event");
        require(!q.released, "QuarantineVault: already released");
        require(block.timestamp >= q.releaseTime, "QuarantineVault: too early");

        q.released = true;
        require(IERC20(q.token).transfer(q.originProtocol, q.amount), "QuarantineVault: push failed");
        emit Released(eventId, q.originProtocol, q.amount);
    }
}
