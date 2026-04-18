// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockOraclePair
/// @notice Minimal Uniswap-V2-style constant-product pair with a
///         spot-price `getPrice()` read. Deliberately no TWAP — this
///         is the vulnerability that VictimLendingPool trusts.
/// @dev    Constant-product math: reserves are mutated on every swap.
///         `getPrice(tokenIn)` returns price of tokenIn denominated in
///         the other token, scaled by 1e18.
contract MockOraclePair {
    IERC20 public immutable token0;
    IERC20 public immutable token1;

    uint256 public reserve0;
    uint256 public reserve1;

    event Swap(address indexed who, address tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(address _token0, address _token1) {
        require(_token0 != address(0) && _token1 != address(0), "MockOraclePair: zero token");
        require(_token0 != _token1, "MockOraclePair: identical");
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
    }

    /// @notice Seed initial liquidity. Caller must have approved both tokens.
    function seed(uint256 amount0, uint256 amount1) external {
        require(reserve0 == 0 && reserve1 == 0, "MockOraclePair: already seeded");
        require(amount0 > 0 && amount1 > 0, "MockOraclePair: zero amount");
        require(token0.transferFrom(msg.sender, address(this), amount0), "MockOraclePair: t0 transfer");
        require(token1.transferFrom(msg.sender, address(this), amount1), "MockOraclePair: t1 transfer");
        reserve0 = amount0;
        reserve1 = amount1;
    }

    /// @notice Swap amountIn of tokenIn for the other token using the
    ///         constant-product formula (no fee for simplicity).
    function swap(address tokenIn, uint256 amountIn) external returns (uint256 amountOut) {
        require(amountIn > 0, "MockOraclePair: zero amountIn");
        bool inIsToken0 = tokenIn == address(token0);
        require(inIsToken0 || tokenIn == address(token1), "MockOraclePair: bad token");

        (uint256 rIn, uint256 rOut, IERC20 tIn, IERC20 tOut) = inIsToken0
            ? (reserve0, reserve1, token0, token1)
            : (reserve1, reserve0, token1, token0);

        require(tIn.transferFrom(msg.sender, address(this), amountIn), "MockOraclePair: pull");

        // constant product: (rIn + amountIn) * (rOut - amountOut) = rIn * rOut
        amountOut = (amountIn * rOut) / (rIn + amountIn);
        require(amountOut > 0 && amountOut < rOut, "MockOraclePair: bad out");

        require(tOut.transfer(msg.sender, amountOut), "MockOraclePair: push");

        if (inIsToken0) {
            reserve0 = rIn + amountIn;
            reserve1 = rOut - amountOut;
        } else {
            reserve1 = rIn + amountIn;
            reserve0 = rOut - amountOut;
        }

        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
    }

    /// @notice Spot price of `tokenIn` denominated in the other token,
    ///         scaled by 1e18. This is the vulnerable spot read.
    function getPrice(address tokenIn) external view returns (uint256) {
        require(reserve0 > 0 && reserve1 > 0, "MockOraclePair: empty");
        if (tokenIn == address(token0)) {
            return (reserve1 * 1e18) / reserve0;
        } else if (tokenIn == address(token1)) {
            return (reserve0 * 1e18) / reserve1;
        }
        revert("MockOraclePair: bad token");
    }

    function getReserves() external view returns (uint256, uint256) {
        return (reserve0, reserve1);
    }
}
