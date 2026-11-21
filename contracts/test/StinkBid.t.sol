// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {StinkBid} from "../src/StinkBid.sol";
import {ISwapRouter02} from "../src/interfaces/ISwapRouter02.sol";
import {MockERC20, FeeOnTransferERC20} from "./mocks/MockERC20.sol";
import {MockRouter} from "./mocks/MockRouter.sol";
import {StinkBidBase} from "./utils/StinkBidBase.sol";

contract StinkBidTest is StinkBidBase {
    ISignatureTransfer permit2;
    MockRouter router;
    MockERC20 usdg;
    MockERC20 stock;
    StinkBid sb;

    uint256 makerKey = 0xA11CE;
    address maker;
    address keeper = makeAddr("keeper");

    uint256 constant AMOUNT = 500e6;

    event Filled(
        address indexed maker,
        uint256 indexed nonce,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address filler
    );

    function setUp() public {
        permit2 = ISignatureTransfer(deployCode("Permit2.sol:Permit2"));
        router = new MockRouter();
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        stock = new MockERC20("Stock", "STK", 18);
        sb = new StinkBid(permit2, ISwapRouter02(address(router)), address(usdg));

        maker = vm.addr(makerKey);
        usdg.mint(maker, 10_000e6);
        vm.prank(maker);
        usdg.approve(address(permit2), type(uint256).max);
        // 1 USDG (1e6) buys 0.004 STK (4e15): a "price" of 250 USDG per STK.
        router.setRate(4e9, 1);
    }

    function _order(uint256 minOut) internal view returns (StinkBid.Order memory) {
        return StinkBid.Order({maker: maker, tokenOut: address(stock), minAmountOut: minOut});
    }

    function _fill(StinkBid.Order memory o, ISignatureTransfer.PermitTransferFrom memory p, bytes memory sig)
        internal
        returns (uint256)
    {
        vm.prank(keeper);
        return sb.fill(o, p, sig, _path(address(usdg), 500, address(stock)));
    }

    function test_fill_paysMakerAndLeavesNothingBehind() public {
        StinkBid.Order memory o = _order(2e18);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, makerKey, o, p);

        vm.expectEmit(address(sb));
        emit Filled(maker, 1, address(stock), AMOUNT, 2e18, keeper);
        uint256 out = _fill(o, p, sig);

        assertEq(out, 2e18);
        assertEq(stock.balanceOf(maker), 2e18);
        assertEq(usdg.balanceOf(maker), 10_000e6 - AMOUNT);
        assertEq(usdg.balanceOf(address(sb)), 0);
        assertEq(stock.balanceOf(address(sb)), 0);
        assertEq(usdg.balanceOf(keeper), 0);
        assertEq(usdg.allowance(address(sb), address(router)), 0);
    }

    function test_fill_belowLevel_revertsAndNothingMoves() public {
        StinkBid.Order memory o = _order(2e18 + 1);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, makerKey, o, p);

        vm.expectRevert("Too little received");
        _fill(o, p, sig);
        assertEq(usdg.balanceOf(maker), 10_000e6);
    }

    function test_fill_routerIgnoringMinimum_stillReverts() public {
        router.setEnforceMin(false);
        StinkBid.Order memory o = _order(3e18);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, makerKey, o, p);

        vm.expectRevert(abi.encodeWithSelector(StinkBid.InsufficientOutput.selector, 2e18, 3e18));
        _fill(o, p, sig);
        assertEq(usdg.balanceOf(maker), 10_000e6);
    }

    function test_fill_feeOnTransferOutput_measuredAtMaker() public {
        FeeOnTransferERC20 fot = new FeeOnTransferERC20(100); // 1% burned on transfer
        router.setEnforceMin(false);
        StinkBid.Order memory o = StinkBid.Order({maker: maker, tokenOut: address(fot), minAmountOut: 2e18});
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, makerKey, o, p);

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(StinkBid.InsufficientOutput.selector, 1.98e18, 2e18));
        sb.fill(o, p, sig, _path(address(usdg), 500, address(fot)));
    }

    function test_fill_routerUnderspending_reverts() public {
        router.setUnderspendBps(10);
        StinkBid.Order memory o = _order(1e18);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, makerKey, o, p);

        vm.expectRevert(StinkBid.InputNotSpent.selector);
        _fill(o, p, sig);
    }

    function test_fill_twice_secondReverts() public {
        StinkBid.Order memory o = _order(1e18);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 7, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, makerKey, o, p);
        _fill(o, p, sig);

        vm.expectRevert(abi.encodeWithSignature("InvalidNonce()"));
        _fill(o, p, sig);
        assertEq(usdg.balanceOf(maker), 10_000e6 - AMOUNT);
    }

    function test_fill_afterMakerRevokesNonce_reverts() public {
        StinkBid.Order memory o = _order(1e18);
        uint256 nonce = (3 << 8) | 5; // word 3, bit 5
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, nonce, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, makerKey, o, p);

        vm.prank(maker);
        permit2.invalidateUnorderedNonces(3, 1 << 5);

        vm.expectRevert(abi.encodeWithSignature("InvalidNonce()"));
        _fill(o, p, sig);
    }

    function test_fill_expired_reverts() public {
        StinkBid.Order memory o = _order(1e18);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 hours);
        bytes memory sig = _sign(sb, makerKey, o, p);
        vm.warp(block.timestamp + 1 hours + 1);

        vm.expectRevert(abi.encodeWithSignature("SignatureExpired(uint256)", p.deadline));
        _fill(o, p, sig);
    }

    function test_fill_tamperedOrder_reverts() public {
        StinkBid.Order memory o = _order(2e18);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, makerKey, o, p);

        StinkBid.Order memory lowered = _order(1);
        vm.expectRevert(abi.encodeWithSignature("InvalidSigner()"));
        _fill(lowered, p, sig);

        ISignatureTransfer.PermitTransferFrom memory bigger =
            _permit(address(usdg), AMOUNT * 2, 1, block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSignature("InvalidSigner()"));
        _fill(o, bigger, sig);

        MockERC20 other = new MockERC20("Other", "OTH", 18);
        StinkBid.Order memory swapped = StinkBid.Order({maker: maker, tokenOut: address(other), minAmountOut: 2e18});
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSignature("InvalidSigner()"));
        sb.fill(swapped, p, sig, _path(address(usdg), 500, address(other)));
    }

    function test_fill_signatureForAnotherSpender_reverts() public {
        StinkBid other = new StinkBid(permit2, ISwapRouter02(address(router)), address(usdg));
        StinkBid.Order memory o = _order(1e18);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        bytes memory sigForOther = _sign(other, makerKey, o, p);

        vm.expectRevert(abi.encodeWithSignature("InvalidSigner()"));
        _fill(o, p, sigForOther);
    }

    function test_fill_otherMaker_cannotSpendVictim() public {
        uint256 attackerKey = 0xBAD;
        StinkBid.Order memory o = _order(1);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, attackerKey, o, p); // order names the victim as maker

        vm.expectRevert(abi.encodeWithSignature("InvalidSigner()"));
        _fill(o, p, sig);
        assertEq(usdg.balanceOf(maker), 10_000e6);
    }

    function test_fill_wrongInputToken_reverts() public {
        StinkBid.Order memory o = _order(1);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(stock), 1e18, 1, block.timestamp + 1 days);
        vm.expectRevert(StinkBid.WrongInputToken.selector);
        _fill(o, p, "");
    }

    function test_fill_buyingUsdg_reverts() public {
        StinkBid.Order memory o = StinkBid.Order({maker: maker, tokenOut: address(usdg), minAmountOut: 1});
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        vm.prank(keeper);
        vm.expectRevert(StinkBid.SameToken.selector);
        sb.fill(o, p, "", _path(address(usdg), 500, address(usdg)));
    }

    function test_fill_badPaths_revert() public {
        StinkBid.Order memory o = _order(1);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        MockERC20 mid = new MockERC20("Mid", "MID", 18);

        bytes[5] memory bad = [
            abi.encodePacked(address(usdg)),
            abi.encodePacked(address(usdg), uint24(500), address(stock), uint8(0)),
            _path(address(stock), 500, address(stock)),
            _path(address(usdg), 500, address(mid)),
            abi.encodePacked(address(mid), uint24(500), address(usdg), uint24(500), address(stock))
        ];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(keeper);
            vm.expectRevert(StinkBid.BadPath.selector);
            sb.fill(o, p, "", bad[i]);
        }
    }

    function test_fill_multiHopPath_works() public {
        MockERC20 weth = new MockERC20("WETH", "WETH", 18);
        StinkBid.Order memory o = _order(2e18);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, makerKey, o, p);
        bytes memory path = abi.encodePacked(address(usdg), uint24(500), address(weth), uint24(3000), address(stock));
        vm.prank(keeper);
        assertEq(sb.fill(o, p, sig, path), 2e18);
    }

    function test_fill_reentryFromRouter_reverts() public {
        StinkBid.Order memory o = _order(1e18);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, makerKey, o, p);

        ISignatureTransfer.PermitTransferFrom memory p2 = _permit(address(usdg), AMOUNT, 2, block.timestamp + 1 days);
        bytes memory sig2 = _sign(sb, makerKey, o, p2);
        router.setReenter(
            address(sb), abi.encodeCall(sb.fill, (o, p2, sig2, _path(address(usdg), 500, address(stock))))
        );

        vm.expectRevert(StinkBid.Reentrancy.selector);
        _fill(o, p, sig);
        assertEq(usdg.balanceOf(maker), 10_000e6);
    }

    function test_fill_makerWithoutBalance_reverts() public {
        uint256 poorKey = 0xB0B;
        address poor = vm.addr(poorKey);
        vm.prank(poor);
        usdg.approve(address(permit2), type(uint256).max);
        StinkBid.Order memory o = StinkBid.Order({maker: poor, tokenOut: address(stock), minAmountOut: 1});
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), AMOUNT, 1, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, poorKey, o, p);

        vm.expectRevert();
        _fill(o, p, sig);
    }

    function test_hashOrder_matchesEip712() public view {
        StinkBid.Order memory o = _order(123);
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("Order(address maker,address tokenOut,uint256 minAmountOut)"), maker, address(stock), 123
            )
        );
        assertEq(sb.hashOrder(o), expected);
    }

    /// Fills exactly when the swap pays at least the signed minimum; otherwise the maker's USDG does not move.
    function testFuzz_fill_onlyAtOrBelowLevel(uint96 amountIn, uint64 rate, uint128 minOut) public {
        amountIn = uint96(bound(amountIn, 1, 10_000e6));
        rate = uint64(bound(rate, 0, 1e13));
        router.setRate(rate, 1);
        router.setEnforceMin(false);

        StinkBid.Order memory o = _order(minOut);
        ISignatureTransfer.PermitTransferFrom memory p = _permit(address(usdg), amountIn, 9, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, makerKey, o, p);
        uint256 expected = uint256(amountIn) * rate;

        vm.prank(keeper);
        if (expected >= minOut) {
            uint256 out = sb.fill(o, p, sig, _path(address(usdg), 500, address(stock)));
            assertEq(out, expected);
            assertGe(stock.balanceOf(maker), minOut);
            assertEq(usdg.balanceOf(maker), 10_000e6 - amountIn);
        } else {
            vm.expectRevert(abi.encodeWithSelector(StinkBid.InsufficientOutput.selector, expected, minOut));
            sb.fill(o, p, sig, _path(address(usdg), 500, address(stock)));
            assertEq(usdg.balanceOf(maker), 10_000e6);
        }
        assertEq(usdg.balanceOf(address(sb)), 0);
        assertEq(stock.balanceOf(address(sb)), 0);
    }

    /// No signature from a different key can move the maker's USDG, whatever the order says.
    function testFuzz_fill_foreignKeyNeverSpends(uint256 key, uint96 amountIn, uint256 nonce) public {
        key = bound(key, 1, 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140);
        vm.assume(key != makerKey);
        amountIn = uint96(bound(amountIn, 1, 10_000e6));
        StinkBid.Order memory o = _order(0);
        ISignatureTransfer.PermitTransferFrom memory p =
            _permit(address(usdg), amountIn, nonce, block.timestamp + 1 days);
        bytes memory sig = _sign(sb, key, o, p);

        vm.expectRevert(abi.encodeWithSignature("InvalidSigner()"));
        _fill(o, p, sig);
        assertEq(usdg.balanceOf(maker), 10_000e6);
    }
}
