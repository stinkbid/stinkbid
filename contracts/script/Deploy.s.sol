// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {StinkBid} from "../src/StinkBid.sol";
import {ISwapRouter02} from "../src/interfaces/ISwapRouter02.sol";

/// @notice Deploys StinkBid on Robinhood Chain through the deterministic CREATE2 deployer, so the address depends
///         only on the source, the compiler settings and the salt, never on who deploys or when.
/// Dry run (prints the address):  forge script script/Deploy.s.sol --rpc-url robinhood
/// Deploy:                        forge script script/Deploy.s.sol --rpc-url robinhood --account <keystore> --broadcast
contract Deploy is Script {
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    bytes32 constant SALT = keccak256("stinkbid.v1");

    function run() external returns (StinkBid sb) {
        require(block.chainid == 4663, "not Robinhood Chain");
        bytes memory initCode = abi.encodePacked(
            type(StinkBid).creationCode, abi.encode(ISignatureTransfer(PERMIT2), ISwapRouter02(ROUTER), USDG)
        );
        address predicted = vm.computeCreate2Address(SALT, keccak256(initCode));
        console2.log("StinkBid address:", predicted);
        if (predicted.code.length != 0) {
            console2.log("Already deployed.");
            return StinkBid(predicted);
        }
        vm.startBroadcast();
        sb = new StinkBid{salt: SALT}(ISignatureTransfer(PERMIT2), ISwapRouter02(ROUTER), USDG);
        vm.stopBroadcast();
        require(address(sb) == predicted, "address mismatch");
        require(sb.USDG() == USDG && address(sb.ROUTER()) == ROUTER && address(sb.PERMIT2()) == PERMIT2, "bad wiring");
    }
}
