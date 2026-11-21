// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {StinkBid} from "../../src/StinkBid.sol";

/// @dev Signing helpers shared by unit, fuzz, invariant and fork tests.
abstract contract StinkBidBase is Test {
    bytes32 internal constant TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");

    function _permitTypehash(StinkBid sb) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,",
                sb.WITNESS_TYPE_STRING()
            )
        );
    }

    function _sign(
        StinkBid sb,
        uint256 makerKey,
        StinkBid.Order memory order,
        ISignatureTransfer.PermitTransferFrom memory permit
    ) internal view returns (bytes memory) {
        bytes32 witness = keccak256(abi.encode(sb.ORDER_TYPEHASH(), order.maker, order.tokenOut, order.minAmountOut));
        bytes32 tokenPermissions =
            keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, permit.permitted.token, permit.permitted.amount));
        bytes32 structHash = keccak256(
            abi.encode(_permitTypehash(sb), tokenPermissions, address(sb), permit.nonce, permit.deadline, witness)
        );
        bytes32 domain = ISignatureTransfer(address(sb.PERMIT2())).DOMAIN_SEPARATOR();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _permit(address token, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        pure
        returns (ISignatureTransfer.PermitTransferFrom memory)
    {
        return ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions({token: token, amount: amount}),
            nonce: nonce,
            deadline: deadline
        });
    }

    function _path(address a, uint24 fee, address b) internal pure returns (bytes memory) {
        return abi.encodePacked(a, fee, b);
    }
}
