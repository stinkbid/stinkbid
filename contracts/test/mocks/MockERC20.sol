// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "solmate/src/tokens/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol, uint8 decimals) ERC20(name, symbol, decimals) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Burns `feeBps` of every transfer, so the receiver gets less than the sender sent.
contract FeeOnTransferERC20 is MockERC20 {
    uint256 public immutable feeBps;

    constructor(uint256 feeBps_) MockERC20("Fee Token", "FEE", 18) {
        feeBps = feeBps_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        uint256 fee = (amount * feeBps) / 10_000;
        _burn(msg.sender, fee);
        return super.transfer(to, amount - fee);
    }
}
