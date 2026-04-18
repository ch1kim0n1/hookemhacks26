// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SentinelGuard} from "./SentinelGuard.sol";
import {MockOraclePair} from "./mocks/MockOraclePair.sol";

/// @title VictimLendingPool
/// @notice Deliberately-vulnerable USDC/ETH lending pool used in demo
///         Scenario A (flash-loan oracle manipulation). Borrowers post
///         USDC collateral and receive ETH at the **raw spot price**
///         from the oracle pair — no TWAP, no sanity bounds. This is
///         the vulnerability the attacker exploits.
/// @dev    Doc 02 §VictimLendingPool. `sentinelProtected` on every
///         user-facing function so an active Pause defense blocks calls.
contract VictimLendingPool {
    SentinelGuard public immutable sentinel;
    IERC20 public immutable usdc;
    IERC20 public immutable weth;
    MockOraclePair public immutable oraclePair;

    // Loan-to-value: borrow up to 80% of collateral value.
    uint256 public constant LTV_BPS = 8000;
    uint256 public constant BPS_DENOM = 10000;

    // Tracked balances (separate from ERC20 balances so tests can read).
    uint256 public totalCollateralUsdc;
    uint256 public totalBorrowedWeth;
    mapping(address => uint256) public collateralOf;
    mapping(address => uint256) public debtOf;

    event Deposited(address indexed user, uint256 usdcAmount);
    event Borrowed(address indexed user, uint256 wethAmount, uint256 usdcPerEth);
    event LiquidityFunded(uint256 wethAmount);

    modifier sentinelProtected() {
        require(sentinel.isAllowed(address(this), msg.sig), "SENTINEL: halted");
        _;
    }

    constructor(address _sentinel, address _usdc, address _weth, address _oraclePair) {
        require(_sentinel != address(0), "VictimLendingPool: zero sentinel");
        require(_usdc != address(0), "VictimLendingPool: zero usdc");
        require(_weth != address(0), "VictimLendingPool: zero weth");
        require(_oraclePair != address(0), "VictimLendingPool: zero oracle");
        sentinel = SentinelGuard(_sentinel);
        usdc = IERC20(_usdc);
        weth = IERC20(_weth);
        oraclePair = MockOraclePair(_oraclePair);
    }

    /// @notice Seed the pool with borrowable WETH. Anyone can fund;
    ///         this is the demo equivalent of LPs depositing.
    function fundLiquidity(uint256 wethAmount) external {
        require(wethAmount > 0, "VictimLendingPool: zero amount");
        require(weth.transferFrom(msg.sender, address(this), wethAmount), "VictimLendingPool: weth pull");
        emit LiquidityFunded(wethAmount);
    }

    /// @notice Post USDC collateral.
    function deposit(uint256 usdcAmount) external sentinelProtected {
        require(usdcAmount > 0, "VictimLendingPool: zero amount");
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "VictimLendingPool: usdc pull");
        collateralOf[msg.sender] += usdcAmount;
        totalCollateralUsdc += usdcAmount;
        emit Deposited(msg.sender, usdcAmount);
    }

    /// @notice Borrow WETH against deposited USDC collateral. Uses the
    ///         raw spot price from the oracle — this is exploitable.
    ///         `wethAmount` is the amount to borrow. Max = LTV * collateral / price.
    function borrow(uint256 wethAmount) external sentinelProtected {
        require(wethAmount > 0, "VictimLendingPool: zero amount");
        require(weth.balanceOf(address(this)) >= wethAmount, "VictimLendingPool: insufficient liquidity");

        // price = USDC per 1e18 WETH, from the pair.
        uint256 usdcPerEth = oraclePair.getPrice(address(weth));

        uint256 collateral = collateralOf[msg.sender];
        uint256 existingDebt = debtOf[msg.sender];

        // Collateral value in WETH-equivalent units: collateralUsdc * 1e18 / usdcPerEth.
        uint256 collateralInWeth = (collateral * 1e18) / usdcPerEth;
        uint256 newDebt = existingDebt + wethAmount;
        uint256 maxDebt = (collateralInWeth * LTV_BPS) / BPS_DENOM;
        require(newDebt <= maxDebt, "VictimLendingPool: over LTV");

        debtOf[msg.sender] = newDebt;
        totalBorrowedWeth += wethAmount;
        require(weth.transfer(msg.sender, wethAmount), "VictimLendingPool: weth push");
        emit Borrowed(msg.sender, wethAmount, usdcPerEth);
    }

    /// @notice Convenience: unlocked WETH liquidity remaining.
    function availableLiquidity() external view returns (uint256) {
        return weth.balanceOf(address(this));
    }
}
