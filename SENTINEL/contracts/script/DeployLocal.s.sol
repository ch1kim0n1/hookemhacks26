// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {IRiscZeroVerifier} from "risc0-ethereum/IRiscZeroVerifier.sol";
import {RiscZeroGroth16Verifier} from "risc0-ethereum/groth16/RiscZeroGroth16Verifier.sol";
import {ControlID} from "risc0-ethereum/groth16/ControlID.sol";
import {RiscZeroMockVerifier} from "risc0-ethereum/test/RiscZeroMockVerifier.sol";

import {PolicyVerifier} from "../src/verifiers/PolicyVerifier.sol";
import {LearningVerifier} from "../src/verifiers/LearningVerifier.sol";
import {CounterfactualVerifier} from "../src/verifiers/CounterfactualVerifier.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {CounterfactualLedger} from "../src/CounterfactualLedger.sol";
import {ThreatRegistry} from "../src/ThreatRegistry.sol";
import {QuarantineVault} from "../src/QuarantineVault.sol";
import {PauseController} from "../src/PauseController.sol";
import {SentinelGuard} from "../src/SentinelGuard.sol";
import {VictimLendingPool} from "../src/VictimLendingPool.sol";
import {SiblingLendingPool} from "../src/SiblingLendingPool.sol";
import {FlashLoanAttacker} from "../src/demo/FlashLoanAttacker.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOraclePair} from "../src/mocks/MockOraclePair.sol";
import {MockFlashLoanProvider} from "../src/mocks/MockFlashLoanProvider.sol";

/// @title DeployLocal
/// @notice Writes every address to `../config/addresses.local.json`.
///
///         ZK wiring:
///         - RISC0_DEV_MODE=1 → deploys `RiscZeroMockVerifier` (accepts
///           the 0xFFFFFFFF-selector dev seals).
///         - RISC0_DEV_MODE=0 → deploys real `RiscZeroGroth16Verifier`
///           with the canonical BN254 control IDs.
///
///         Image IDs are read from `../config/zk-image-ids.json`, which
///         is produced by `cargo run -p sentinel-zk-host --bin
///         dump_image_ids` after the guest ELFs are built.
contract DeployLocal is Script {
    // Anvil default accounts (from the `junk` mnemonic).
    address constant ANVIL_ACCOUNT_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // defense agent
    address constant ANVIL_ACCOUNT_2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // prover
    address constant ANVIL_ACCOUNT_3 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // threat registry operator

    // Mock verifier selector — matches `encode_seal` for Fake receipts.
    bytes4 constant MOCK_SELECTOR = 0xFFFFFFFF;

    struct Deployed {
        address risc0Verifier;
        address policyVerifier;
        address learningVerifier;
        address counterfactualVerifier;
        address policyRegistry;
        address counterfactualLedger;
        address threatRegistry;
        address quarantineVault;
        address pauseController;
        address sentinelGuard;
        address usdc;
        address weth;
        address oraclePair;
        address flashLoanProvider;
        address victimLendingPool;
        address flashLoanAttacker;
        // Sibling pools for immunity-map demo (doc 07 §Immunity Map).
        address siblingPoolAave;
        address siblingPoolCompound;
        address siblingPoolCurve;
    }

    struct ImageIds {
        bytes32 policy;
        bytes32 counterfactual;
        bytes32 learning;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        bytes32 policyHash = vm.envOr(
            "POLICY_HASH",
            bytes32(keccak256("sentinel-v2-phase1-policy"))
        );
        uint256 attackerKey = vm.envOr(
            "ATTACKER_KEY",
            uint256(0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba)
        );
        ImageIds memory ids = _loadImageIds();

        vm.startBroadcast(deployerKey);
        Deployed memory d = _deployVerifiers(ids);
        d = _deployCore(d);
        d = _deployMocks(d);
        PolicyRegistry(d.policyRegistry).initialize(policyHash, ANVIL_ACCOUNT_1);
        vm.stopBroadcast();

        vm.startBroadcast(attackerKey);
        d.flashLoanAttacker = address(
            new FlashLoanAttacker(d.victimLendingPool, d.oraclePair, d.usdc, d.weth)
        );
        vm.stopBroadcast();

        _writeAddresses(d);
        _logDeployed(d);
        console2.log("Policy hash initialized:");
        console2.logBytes32(policyHash);
    }

    function _loadImageIds() internal view returns (ImageIds memory ids) {
        bool devMode = vm.envOr("RISC0_DEV_MODE", uint256(1)) == 1;
        string memory path = "../config/zk-image-ids.json";
        string memory raw = vm.readFile(path);
        ids.policy = vm.parseJsonBytes32(raw, ".PolicyCompliance");
        ids.counterfactual = vm.parseJsonBytes32(raw, ".CounterfactualCorrectness");
        ids.learning = vm.parseJsonBytes32(raw, ".LearningLoopCorrectness");
        // In dev mode, RiscZeroMockVerifier ignores image IDs — only enforce
        // non-zero for production deploys where the real Groth16 verifier pins them.
        if (!devMode) {
            require(ids.policy != bytes32(0), "DeployLocal: zero policy imageId");
            require(ids.counterfactual != bytes32(0), "DeployLocal: zero counterfactual imageId");
            require(ids.learning != bytes32(0), "DeployLocal: zero learning imageId");
        }
    }

    function _deployVerifiers(ImageIds memory ids) internal returns (Deployed memory d) {
        bool devMode = vm.envOr("RISC0_DEV_MODE", uint256(1)) == 1;
        IRiscZeroVerifier risc0;
        if (devMode) {
            risc0 = new RiscZeroMockVerifier(MOCK_SELECTOR);
            console2.log("Deployed RiscZeroMockVerifier (dev mode) to", address(risc0));
        } else {
            risc0 = new RiscZeroGroth16Verifier(ControlID.CONTROL_ROOT, ControlID.BN254_CONTROL_ID);
            console2.log("Deployed RiscZeroGroth16Verifier (prod) to", address(risc0));
        }
        d.risc0Verifier = address(risc0);
        d.policyVerifier = address(new PolicyVerifier(risc0, ids.policy));
        d.counterfactualVerifier = address(new CounterfactualVerifier(risc0, ids.counterfactual));
        d.learningVerifier = address(new LearningVerifier(risc0, ids.learning));
    }

    function _deployCore(Deployed memory d) internal returns (Deployed memory) {
        d.policyRegistry = address(new PolicyRegistry(d.policyVerifier, d.learningVerifier));
        d.counterfactualLedger = address(
            new CounterfactualLedger(d.counterfactualVerifier, ANVIL_ACCOUNT_2)
        );
        d.threatRegistry = address(new ThreatRegistry(ANVIL_ACCOUNT_3));
        d.quarantineVault = address(new QuarantineVault());
        d.pauseController = address(new PauseController(d.policyRegistry, d.quarantineVault));
        QuarantineVault(d.quarantineVault).setPauseController(d.pauseController);
        d.sentinelGuard = address(new SentinelGuard(d.pauseController));
        return d;
    }

    function _deployMocks(Deployed memory d) internal returns (Deployed memory) {
        d.usdc = address(new MockERC20("Mock USDC", "mUSDC", 6));
        d.weth = address(new MockERC20("Mock WETH", "mWETH", 18));
        d.oraclePair = address(new MockOraclePair(d.usdc, d.weth));
        d.flashLoanProvider = address(new MockFlashLoanProvider(d.weth));
        d.victimLendingPool = address(
            new VictimLendingPool(d.sentinelGuard, d.usdc, d.weth, d.oraclePair)
        );
        // Peer protocols: same guard, distinct addresses. The frontend
        // immunity map reads these from addresses.local.json and polls
        // `isAllowed` on each for the ON-CHAIN badge (doc 07 §Immunity Map).
        d.siblingPoolAave = address(new SiblingLendingPool(d.sentinelGuard, "Aave"));
        d.siblingPoolCompound = address(new SiblingLendingPool(d.sentinelGuard, "Compound"));
        d.siblingPoolCurve = address(new SiblingLendingPool(d.sentinelGuard, "Curve"));
        return d;
    }

    function _writeAddresses(Deployed memory d) internal {
        string memory obj = "addresses";
        vm.serializeAddress(obj, "PolicyRegistry", d.policyRegistry);
        vm.serializeAddress(obj, "CounterfactualLedger", d.counterfactualLedger);
        vm.serializeAddress(obj, "PauseController", d.pauseController);
        vm.serializeAddress(obj, "QuarantineVault", d.quarantineVault);
        vm.serializeAddress(obj, "ThreatRegistry", d.threatRegistry);
        vm.serializeAddress(obj, "SentinelGuard", d.sentinelGuard);
        vm.serializeAddress(obj, "VictimLendingPool", d.victimLendingPool);
        vm.serializeAddress(obj, "RiscZeroVerifier", d.risc0Verifier);
        vm.serializeAddress(obj, "PolicyVerifier", d.policyVerifier);
        vm.serializeAddress(obj, "LearningVerifier", d.learningVerifier);
        vm.serializeAddress(obj, "CounterfactualVerifier", d.counterfactualVerifier);
        vm.serializeAddress(obj, "FlashLoanAttacker", d.flashLoanAttacker);
        vm.serializeAddress(obj, "USDC", d.usdc);
        vm.serializeAddress(obj, "WETH", d.weth);
        vm.serializeAddress(obj, "OraclePair", d.oraclePair);
        vm.serializeAddress(obj, "FlashLoanProvider", d.flashLoanProvider);
        vm.serializeAddress(obj, "SiblingPoolAave", d.siblingPoolAave);
        vm.serializeAddress(obj, "SiblingPoolCompound", d.siblingPoolCompound);
        string memory json = vm.serializeAddress(obj, "SiblingPoolCurve", d.siblingPoolCurve);
        vm.writeJson(json, "../config/addresses.local.json");
    }

    function _logDeployed(Deployed memory d) internal pure {
        console2.log("=== SENTINEL v2 deployment ===");
        console2.log("RiscZeroVerifier:     ", d.risc0Verifier);
        console2.log("PolicyVerifier:       ", d.policyVerifier);
        console2.log("CounterfactualVerifier:", d.counterfactualVerifier);
        console2.log("LearningVerifier:     ", d.learningVerifier);
        console2.log("PolicyRegistry:       ", d.policyRegistry);
        console2.log("CounterfactualLedger: ", d.counterfactualLedger);
        console2.log("PauseController:      ", d.pauseController);
        console2.log("SentinelGuard:        ", d.sentinelGuard);
        console2.log("VictimLendingPool:    ", d.victimLendingPool);
        console2.log("FlashLoanAttacker:    ", d.flashLoanAttacker);
        console2.log("USDC:                 ", d.usdc);
        console2.log("WETH:                 ", d.weth);
        console2.log("OraclePair:           ", d.oraclePair);
        console2.log("FlashLoanProvider:    ", d.flashLoanProvider);
        console2.log("SiblingPoolAave:      ", d.siblingPoolAave);
        console2.log("SiblingPoolCompound:  ", d.siblingPoolCompound);
        console2.log("SiblingPoolCurve:     ", d.siblingPoolCurve);
    }
}
