// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ThreatRegistry.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("CLAWGUARD_PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        ThreatRegistry registry = new ThreatRegistry();

        vm.stopBroadcast();

        console.log("ThreatRegistry deployed at:", address(registry));
    }
}
