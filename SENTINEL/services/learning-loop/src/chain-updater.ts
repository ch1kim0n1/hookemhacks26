import { http, type Hex, createPublicClient, createWalletClient, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { log } from "./logger.js";
import type { LearningProof } from "./proof-generator.js";

const POLICY_REGISTRY_ABI = parseAbi([
    "function currentPolicyHash() view returns (bytes32)",
    "function updatePolicy(bytes32 newPolicyHash, bytes proof, bytes32[] publicInputs) returns (bool)",
    "event PolicyUpdated(bytes32 indexed oldHash, bytes32 indexed newHash, address indexed updater, uint256 version)",
]);

export interface ChainUpdaterConfig {
    rpcUrl: string;
    policyRegistryAddress: Hex;
    /** Private key for the learning-loop operator (Anvil account) */
    operatorKey: Hex;
}

export class ChainUpdater {
    private config: ChainUpdaterConfig;

    constructor(config: ChainUpdaterConfig) {
        this.config = config;
    }

    /** Read the current policy hash from the chain */
    async getCurrentPolicyHash(): Promise<Hex> {
        const pub = createPublicClient({ transport: http(this.config.rpcUrl) });
        const hash = await pub.readContract({
            address: this.config.policyRegistryAddress,
            abi: POLICY_REGISTRY_ABI,
            functionName: "currentPolicyHash",
        });
        return hash as Hex;
    }

    /**
     * Submit a policy update transaction with the learning proof.
     * Returns the transaction hash.
     */
    async submitPolicyUpdate(proof: LearningProof): Promise<{
        txHash: Hex;
        blockNumber: bigint;
        oldHash: Hex;
        newHash: Hex;
    }> {
        const account = privateKeyToAccount(this.config.operatorKey);
        const pub = createPublicClient({ transport: http(this.config.rpcUrl) });
        const wallet = createWalletClient({
            account,
            transport: http(this.config.rpcUrl),
        });

        const oldHash = await this.getCurrentPolicyHash();
        const newHash = proof.publicInputs[1] as Hex;

        log.info(
            {
                oldHash: oldHash.slice(0, 10) + "...",
                newHash: newHash.slice(0, 10) + "...",
            },
            "submitting policy update",
        );

        // Convert proof and public inputs to proper hex format
        const proofBytes = proof.proofHex as Hex;
        const publicInputs = proof.publicInputs.map((pi) => {
            // Pad to 32 bytes
            const hex = pi.startsWith("0x") ? pi.slice(2) : pi;
            return ("0x" + hex.padStart(64, "0")) as Hex;
        });

        const hash = await wallet.writeContract({
            address: this.config.policyRegistryAddress,
            abi: POLICY_REGISTRY_ABI,
            functionName: "updatePolicy",
            args: [publicInputs[1] as Hex, proofBytes, publicInputs],
            chain: null,
        });

        const receipt = await pub.waitForTransactionReceipt({ hash });

        log.info(
            {
                txHash: hash,
                blockNumber: Number(receipt.blockNumber),
                status: receipt.status,
            },
            "policy update mined",
        );

        return {
            txHash: hash,
            blockNumber: receipt.blockNumber,
            oldHash,
            newHash,
        };
    }
}
