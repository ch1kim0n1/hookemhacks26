// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    /// @notice Called by the flash loan provider after the loan amount has
    ///         been sent. Receiver must repay `amount + fee` within this call.
    function onFlashLoan(address token, uint256 amount, bytes calldata data) external;
}

/// @title MockFlashLoanProvider
/// @notice Zero-fee flash-loan pool for demo purposes. Pre-funded with
///         the loan asset. Caller's `onFlashLoan` must leave balance
///         >= amount (no fee for simplicity) before this function returns.
contract MockFlashLoanProvider {
    IERC20 public immutable asset;

    event FlashLoan(address indexed receiver, uint256 amount);

    constructor(address _asset) {
        require(_asset != address(0), "MockFlashLoanProvider: zero asset");
        asset = IERC20(_asset);
    }

    /// @notice Executes a flash loan: sends `amount` to `receiver`, calls
    ///         `receiver.onFlashLoan(...)`, then asserts the balance has
    ///         been restored. Reverts if not.
    function flashLoan(uint256 amount, address receiver, bytes calldata data) external {
        uint256 balanceBefore = asset.balanceOf(address(this));
        require(balanceBefore >= amount, "MockFlashLoanProvider: insufficient liquidity");

        require(asset.transfer(receiver, amount), "MockFlashLoanProvider: out");

        IFlashLoanReceiver(receiver).onFlashLoan(address(asset), amount, data);

        uint256 balanceAfter = asset.balanceOf(address(this));
        require(balanceAfter >= balanceBefore, "MockFlashLoanProvider: not repaid");

        emit FlashLoan(receiver, amount);
    }
}
