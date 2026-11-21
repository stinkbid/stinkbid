// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {StinkBid} from "../src/StinkBid.sol";
import {ISwapRouter02} from "../src/interfaces/ISwapRouter02.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockRouter} from "./mocks/MockRouter.sol";
import {StinkBidBase} from "./utils/StinkBidBase.sol";

/// @dev Random sequence of: makers signing orders, anyone filling them at any market rate (including a router that
///      ignores the minimum), makers revoking nonces, and time passing. Ghost variables record what should be true.
contract Handler is StinkBidBase {
    StinkBid public sb;
    ISignatureTransfer public permit2;
    MockRouter public router;
    MockERC20 public usdg;
    MockERC20 public stock;

    uint256[3] public keys = [uint256(0xA1), 0xB2, 0xC3];

    struct Signed {
        uint256 key;
        StinkBid.Order order;
        ISignatureTransfer.PermitTransferFrom permit;
        bytes sig;
    }

    Signed[] internal book;
    mapping(address => uint256) public ghostSpent;
    mapping(address => uint256) public ghostReceived;
    mapping(address => uint256) public ghostMinOwed;
    uint256 public ghostFills;
    uint256 public ghostUnauthorizedFills;
    uint256 internal nextNonce = 1;

    constructor(StinkBid sb_, ISignatureTransfer permit2_, MockRouter router_, MockERC20 usdg_, MockERC20 stock_) {
        sb = sb_;
        permit2 = permit2_;
        router = router_;
        usdg = usdg_;
        stock = stock_;
    }

    function maker(uint256 i) public view returns (address) {
        return vm.addr(keys[i % 3]);
    }

    function sign(uint256 who, uint96 amountIn, uint128 minOut, uint32 ttl) external {
        uint256 key = keys[who % 3];
        amountIn = uint96(bound(amountIn, 1, 2_000e6));
        ttl = uint32(bound(ttl, 1, 30 days));
        StinkBid.Order memory o = StinkBid.Order({maker: vm.addr(key), tokenOut: address(stock), minAmountOut: minOut});
        ISignatureTransfer.PermitTransferFrom memory p =
            _permit(address(usdg), amountIn, nextNonce++, block.timestamp + ttl);
        book.push(Signed({key: key, order: o, permit: p, sig: _sign(sb, key, o, p)}));
    }

    function fill(uint256 idx, uint64 rate, bool routerHonest, address caller) external {
        if (book.length == 0) return;
        Signed storage s = book[idx % book.length];
        router.setRate(bound(rate, 0, 1e13), 1);
        router.setEnforceMin(routerHonest);
        address m = s.order.maker;
        uint256 usdgBefore = usdg.balanceOf(m);
        uint256 stockBefore = stock.balanceOf(m);

        vm.prank(caller);
        try sb.fill(s.order, s.permit, s.sig, _path(address(usdg), 500, address(stock))) returns (uint256 out) {
            ghostFills++;
            ghostSpent[m] += usdgBefore - usdg.balanceOf(m);
            ghostReceived[m] += stock.balanceOf(m) - stockBefore;
            ghostMinOwed[m] += s.order.minAmountOut;
            if (usdgBefore - usdg.balanceOf(m) != s.permit.permitted.amount || out < s.order.minAmountOut) {
                ghostUnauthorizedFills++;
            }
        } catch {}
    }

    /// Replays a signed order with one field changed. Must never succeed.
    function forge_(uint256 idx, uint128 newMin, uint96 newAmount) external {
        if (book.length == 0) return;
        Signed storage s = book[idx % book.length];
        StinkBid.Order memory o = s.order;
        ISignatureTransfer.PermitTransferFrom memory p = s.permit;
        if (newMin != o.minAmountOut) o.minAmountOut = newMin;
        else p.permitted.amount = uint256(newAmount) + p.permitted.amount + 1;
        router.setEnforceMin(false);
        try sb.fill(o, p, s.sig, _path(address(usdg), 500, address(stock))) {
            ghostUnauthorizedFills++;
        } catch {}
    }

    function revoke(uint256 idx) external {
        if (book.length == 0) return;
        Signed storage s = book[idx % book.length];
        uint256 n = s.permit.nonce;
        vm.prank(s.order.maker);
        permit2.invalidateUnorderedNonces(n >> 8, 1 << (n & 0xff));
    }

    function wait(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 7 days));
    }
}

contract StinkBidInvariantTest is StinkBidBase {
    Handler handler;
    StinkBid sb;
    MockERC20 usdg;
    MockERC20 stock;
    uint256 constant START = 1_000_000e6;

    function setUp() public {
        ISignatureTransfer permit2 = ISignatureTransfer(deployCode("Permit2.sol:Permit2"));
        MockRouter router = new MockRouter();
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        stock = new MockERC20("Stock", "STK", 18);
        sb = new StinkBid(permit2, ISwapRouter02(address(router)), address(usdg));
        handler = new Handler(sb, permit2, router, usdg, stock);

        for (uint256 i; i < 3; ++i) {
            address m = handler.maker(i);
            usdg.mint(m, START);
            vm.prank(m);
            usdg.approve(address(permit2), type(uint256).max);
        }

        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = Handler.sign.selector;
        selectors[1] = Handler.fill.selector;
        selectors[2] = Handler.forge_.selector;
        selectors[3] = Handler.revoke.selector;
        selectors[4] = Handler.wait.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// The contract never ends a transaction holding anyone's tokens.
    function invariant_holdsNothing() public view {
        assertEq(usdg.balanceOf(address(sb)), 0);
        assertEq(stock.balanceOf(address(sb)), 0);
    }

    /// USDG leaves a maker only through fills, and only the signed amount per fill.
    function invariant_makerUsdgOnlyLeavesThroughFills() public view {
        for (uint256 i; i < 3; ++i) {
            address m = handler.maker(i);
            assertEq(usdg.balanceOf(m) + handler.ghostSpent(m), START);
        }
    }

    /// Every maker received at least the sum of the minimums of their filled orders.
    function invariant_makersGotAtLeastTheirPrice() public view {
        for (uint256 i; i < 3; ++i) {
            address m = handler.maker(i);
            assertGe(handler.ghostReceived(m), handler.ghostMinOwed(m));
        }
    }

    /// No fill ever moved a different amount, paid under the minimum, or accepted an altered order.
    function invariant_noUnauthorizedFill() public view {
        assertEq(handler.ghostUnauthorizedFills(), 0);
    }
}
