// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Unrestricted test faucet. This token has no economic value.
contract TestToken is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000 ether;
    uint256 public constant COOLDOWN = 1 hours;
    mapping(address => uint256) public nextClaim;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function faucet() external {
        require(block.timestamp >= nextClaim[msg.sender], "Faucet cooldown");
        nextClaim[msg.sender] = block.timestamp + COOLDOWN;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
