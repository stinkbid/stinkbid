// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {MockERC20} from "./MockERC20.sol";

/// @dev Stands in for SwapRouter02. Pays `amountIn * rateNum / rateDen` of the last path token, held in its own
///      balance. Switches let a test make it misbehave in the ways StinkBid must survive.
contract MockRouter is ISwapRouter02 {
    uint256 public rateNum = 1;
    uint256 public rateDen = 1;
    bool public enforceMin = true;
    uint256 public underspendBps;
    address public reenterTarget;
    bytes public reenterData;

    function setRate(uint256 num, uint256 den) external {
        rateNum = num;
        rateDen = den;
    }

    function setEnforceMin(bool on) external {
        enforceMin = on;
    }

    function setUnderspendBps(uint256 bps) external {
        underspendBps = bps;
    }

    function setReenter(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterData = data;
    }

    function exactInput(ExactInputParams calldata p) external payable returns (uint256 amountOut) {
        address tokenIn = address(bytes20(p.path[:20]));
        address tokenOut = address(bytes20(p.path[p.path.length - 20:]));
        uint256 pulled = p.amountIn - (p.amountIn * underspendBps) / 10_000;
        MockERC20(tokenIn).transferFrom(msg.sender, address(this), pulled);
        if (reenterTarget != address(0)) {
            (bool ok, bytes memory ret) = reenterTarget.call(reenterData);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
        amountOut = (p.amountIn * rateNum) / rateDen;
        if (enforceMin) require(amountOut >= p.amountOutMinimum, "Too little received");
        MockERC20(tokenOut).mint(address(this), amountOut);
        MockERC20(tokenOut).transfer(p.recipient, amountOut);
    }
}
