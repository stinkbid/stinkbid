// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The one function StinkBid uses from Uniswap's SwapRouter02.
interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}
