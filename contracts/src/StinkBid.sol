// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";
import {IERC20Min} from "./interfaces/IERC20Min.sol";

/// @title StinkBid
/// @notice Fills signed USDG buy orders ("stink bids") on Uniswap v3 when the market reaches them.
/// @dev A maker approves USDG to Permit2 once, then signs orders off-chain. Each signature is a Permit2
///      witness transfer that binds the order (maker, token to buy, minimum amount out) to one nonce and one
///      deadline, with this contract as the only allowed spender. Anyone may call `fill`: the maker's
///      protection is `minAmountOut`, checked here against the maker's real balance change, not the caller's
///      word. There is no owner, no fee, no pause and no upgrade path. Between transactions the contract
///      holds nothing.
contract StinkBid {
    struct Order {
        address maker;
        address tokenOut;
        uint256 minAmountOut;
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256("Order(address maker,address tokenOut,uint256 minAmountOut)");

    /// @dev Permit2 appends this to "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,
    ///      uint256 nonce,uint256 deadline,". Referenced types follow in alphabetical order, as EIP-712 requires.
    string public constant WITNESS_TYPE_STRING =
        "Order witness)Order(address maker,address tokenOut,uint256 minAmountOut)TokenPermissions(address token,uint256 amount)";

    ISignatureTransfer public immutable PERMIT2;
    ISwapRouter02 public immutable ROUTER;
    address public immutable USDG;

    uint256 private _locked = 1;

    event Filled(
        address indexed maker,
        uint256 indexed nonce,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address filler
    );

    error Reentrancy();
    error WrongInputToken();
    error SameToken();
    error BadPath();
    error InsufficientOutput(uint256 received, uint256 minimum);
    error InputNotSpent();
    error ApproveFailed();

    constructor(ISignatureTransfer permit2, ISwapRouter02 router, address usdg) {
        PERMIT2 = permit2;
        ROUTER = router;
        USDG = usdg;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    /// @notice Pulls the maker's USDG through Permit2, swaps it along `path` and checks what the maker received.
    /// @param order The signed order.
    /// @param permit The signed Permit2 transfer: USDG amount, nonce, deadline.
    /// @param signature The maker's EIP-712 signature over the permit with the order as witness.
    /// @param path Uniswap v3 path, packed as token (20 bytes) then fee (3 bytes) then token, from USDG to `tokenOut`.
    /// @return amountOut Amount of `tokenOut` the maker received.
    function fill(
        Order calldata order,
        ISignatureTransfer.PermitTransferFrom calldata permit,
        bytes calldata signature,
        bytes calldata path
    ) external nonReentrant returns (uint256 amountOut) {
        if (permit.permitted.token != USDG) revert WrongInputToken();
        if (order.tokenOut == USDG) revert SameToken();
        _checkPath(path, order.tokenOut);

        uint256 amountIn = permit.permitted.amount;
        uint256 usdgBefore = IERC20Min(USDG).balanceOf(address(this));

        // Permit2 checks the signature, the deadline and the nonce, and burns the nonce, before any USDG moves.
        PERMIT2.permitWitnessTransferFrom(
            permit,
            ISignatureTransfer.SignatureTransferDetails({to: address(this), requestedAmount: amountIn}),
            order.maker,
            hashOrder(order),
            WITNESS_TYPE_STRING,
            signature
        );

        if (!IERC20Min(USDG).approve(address(ROUTER), amountIn)) revert ApproveFailed();

        uint256 outBefore = IERC20Min(order.tokenOut).balanceOf(order.maker);
        ROUTER.exactInput(
            ISwapRouter02.ExactInputParams({
                path: path,
                recipient: order.maker,
                amountIn: amountIn,
                amountOutMinimum: order.minAmountOut
            })
        );
        amountOut = IERC20Min(order.tokenOut).balanceOf(order.maker) - outBefore;

        // Measured, not reported: a fee-on-transfer token or a misbehaving router cannot under-deliver.
        if (amountOut < order.minAmountOut) revert InsufficientOutput(amountOut, order.minAmountOut);
        if (IERC20Min(USDG).balanceOf(address(this)) != usdgBefore) revert InputNotSpent();

        emit Filled(order.maker, permit.nonce, order.tokenOut, amountIn, amountOut, msg.sender);
    }

    /// @notice EIP-712 struct hash of an order, as signed in the Permit2 witness.
    function hashOrder(Order calldata order) public pure returns (bytes32) {
        return keccak256(abi.encode(ORDER_TYPEHASH, order.maker, order.tokenOut, order.minAmountOut));
    }

    /// @dev Path layout is tokenIn(20) [fee(3) token(20)]*. It must start at USDG and end at the order's token,
    ///      so the caller can pick the route but not the assets.
    function _checkPath(bytes calldata path, address tokenOut) private view {
        if (path.length < 43 || (path.length - 20) % 23 != 0) revert BadPath();
        if (address(bytes20(path[:20])) != USDG) revert BadPath();
        if (address(bytes20(path[path.length - 20:])) != tokenOut) revert BadPath();
    }
}
