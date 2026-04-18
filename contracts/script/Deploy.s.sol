// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ClawGuardRegistry.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("CLAWGUARD_PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        ClawGuardRegistry registry = new ClawGuardRegistry();

        vm.stopBroadcast();

        console.log("ClawGuardRegistry deployed at:", address(registry));
    }
}
