// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MiniDEX} from "./MiniDEX.sol";

/// @notice Caller-funded two-leg atomic arbitrage; no flash loan or privileged withdrawal.
contract AtomicArbitrage is ReentrancyGuard {
    using SafeERC20 for IERC20;
    event ArbitrageExecuted(address indexed trader, address indexed tokenIn, uint256 amountIn, uint256 amountOut, uint256 profit);

    function execute(address dexBuy, uint256 poolBuy, address dexSell, uint256 poolSell,
        address tokenIn, uint256 amountIn, uint256 minProfit, uint256 deadline)
        external nonReentrant returns (uint256 profit)
    {
        require(dexBuy != dexSell || poolBuy != poolSell, "Same pool");
        require(amountIn > 0 && minProfit > 0, "Positive profit required");
        (address a, address b,,,,) = MiniDEX(dexBuy).pools(poolBuy);
        (address c, address d,,,,) = MiniDEX(dexSell).pools(poolSell);
        require((a == c && b == d) || (a == d && b == c), "Pair mismatch");
        require(tokenIn == a || tokenIn == b, "Wrong input");
        address tokenMid = tokenIn == a ? b : a;
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(dexBuy, amountIn);
        uint256 mid = MiniDEX(dexBuy).swap(poolBuy, tokenIn, amountIn, 1, deadline);
        IERC20(tokenMid).forceApprove(dexSell, mid);
        uint256 out = MiniDEX(dexSell).swap(poolSell, tokenMid, mid, amountIn + minProfit, deadline);
        profit = out - amountIn;
        IERC20(tokenIn).forceApprove(dexBuy, 0); IERC20(tokenMid).forceApprove(dexSell, 0);
        IERC20(tokenIn).safeTransfer(msg.sender, out);
        emit ArbitrageExecuted(msg.sender, tokenIn, amountIn, out, profit);
    }
}
