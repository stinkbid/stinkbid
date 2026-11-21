// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {StinkBid} from "../src/StinkBid.sol";
import {ISwapRouter02} from "../src/interfaces/ISwapRouter02.sol";
import {StinkBidBase} from "./utils/StinkBidBase.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IQuoterV2 {
    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        returns (uint256 amountOut, uint160[] memory, uint32[] memory, uint256 gasEstimate);
}

/// @dev Runs against Robinhood Chain (4663) with the real Permit2, USDG, SwapRouter02 and the NVDA/USDG 0.05% pool.
///      Skipped unless FORK_RPC is set: `FORK_RPC=https://robinhood.drpc.org forge test --match-contract Fork`.
contract StinkBidForkTest is StinkBidBase {
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant QUOTER = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;

    StinkBid sb;
    uint256 makerKey = 0x57A1C;
    address maker;
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        assertEq(block.chainid, 4663);

        sb = new StinkBid(ISignatureTransfer(PERMIT2), ISwapRouter02(ROUTER), USDG);
        maker = vm.addr(makerKey);
        deal(USDG, maker, 1_000e6);
        vm.prank(maker);
        IERC20(USDG).approve(PERMIT2, type(uint256).max);
    }

    function _quote(bytes memory path, uint256 amountIn) internal returns (uint256 out) {
        (out,,,) = IQuoterV2(QUOTER).quoteExactInput(path, amountIn);
    }

    function test_fork_fillsAtTheMarket() public {
        if (!forked) return;
        bytes memory path = _path(USDG, 500, NVDA);
        uint256 quoted = _quote(path, 100e6);
        // A bid 1% under the current fill: the market is already there, so it fills.
        StinkBid.Order memory o = StinkBid.Order({maker: maker, tokenOut: NVDA, minAmountOut: (quoted * 99) / 100});
        ISignatureTransfer.PermitTransferFrom memory p = _permit(USDG, 100e6, 1, block.timestamp + 1 hours);
        bytes memory sig = _sign(sb, makerKey, o, p);

        vm.prank(makeAddr("keeper"));
        uint256 out = sb.fill(o, p, sig, path);

        assertEq(out, quoted);
        assertEq(IERC20(NVDA).balanceOf(maker), quoted);
        assertEq(IERC20(USDG).balanceOf(maker), 900e6);
        assertEq(IERC20(USDG).balanceOf(address(sb)), 0);
        assertEq(IERC20(NVDA).balanceOf(address(sb)), 0);
        emit log_named_decimal_uint("NVDA for 100 USDG", out, 18);
    }

    function test_fork_stinkBidWaits() public {
        if (!forked) return;
        bytes memory path = _path(USDG, 500, NVDA);
        uint256 quoted = _quote(path, 100e6);
        // A bid 15% under the price asks for 1/0.85 as many tokens; today's pool cannot pay that, so nothing moves.
        StinkBid.Order memory o =
            StinkBid.Order({maker: maker, tokenOut: NVDA, minAmountOut: (quoted * 100) / 85});
        ISignatureTransfer.PermitTransferFrom memory p = _permit(USDG, 100e6, 2, block.timestamp + 1 hours);
        bytes memory sig = _sign(sb, makerKey, o, p);

        vm.expectRevert();
        sb.fill(o, p, sig, path);
        assertEq(IERC20(USDG).balanceOf(maker), 1_000e6);
        assertEq(IERC20(NVDA).balanceOf(maker), 0);
    }
}
