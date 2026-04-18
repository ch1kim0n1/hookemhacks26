// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import "../src/PauseController.sol";
import "../src/SentinelGuard.sol";
import "../src/mocks/MockOraclePair.sol";
import "../src/VictimLendingPool.sol";

/// @dev Integration tests for the intentionally vulnerable demo pool (oracle spot price, no TWAP).
contract VictimLendingPoolTest is Test {
    ERC20Mock internal usdc;
    ERC20Mock internal weth;
    PauseController internal pause;
    SentinelGuard internal sentinel;
    MockOraclePair internal pair;
    VictimLendingPool internal pool;

    address internal policy = address(0xBEEF);
    address internal vault = address(0xCAFE);
    address internal user = address(0xA11CE);

    function setUp() public {
        usdc = new ERC20Mock();
        weth = new ERC20Mock();
        pause = new PauseController(policy, vault);
        sentinel = new SentinelGuard(address(pause));
        pair = new MockOraclePair(address(usdc), address(weth));
        pool = new VictimLendingPool(address(sentinel), address(usdc), address(weth), address(pair));

        // Seed oracle reserves: USDC (token0) vs WETH (token1) — spot price is manipulable via `swap`.
        usdc.mint(address(this), 1_000_000e18);
        weth.mint(address(this), 1_000e18);
        usdc.approve(address(pair), type(uint256).max);
        weth.approve(address(pair), type(uint256).max);
        pair.seed(1_000_000e18, 1_000e18);

        // Liquidity for borrows.
        weth.mint(address(this), 500e18);
        weth.approve(address(pool), type(uint256).max);
        pool.fundLiquidity(500e18);

        usdc.mint(user, 100_000e18);
        vm.prank(user);
        usdc.approve(address(pool), type(uint256).max);
    }

    function test_deposit_and_borrow_against_oracle_price() public {
        vm.prank(user);
        pool.deposit(10_000e18);

        vm.prank(user);
        pool.borrow(1e18);

        assertEq(pool.debtOf(user), 1e18);
        assertGt(weth.balanceOf(user), 0);
    }

    function test_swap_moves_spot_price_oracle_surface() public {
        uint256 p0 = pair.getPrice(address(weth));
        usdc.mint(address(this), 1_000_000e18);
        usdc.approve(address(pair), type(uint256).max);
        pair.swap(address(usdc), 100_000e18);
        uint256 p1 = pair.getPrice(address(weth));
        assertTrue(p1 != p0, "spot price should move (demo manipulation surface)");
    }
}
