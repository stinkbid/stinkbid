// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Min {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}
