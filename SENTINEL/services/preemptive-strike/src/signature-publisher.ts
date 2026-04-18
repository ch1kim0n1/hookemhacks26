import { http, type Hex, createPublicClient, createWalletClient, keccak256, parseAbi, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { log } from "./logger.js";
import type { ThreatSignature } from "./types.js";

const THREAT_REGISTRY_ABI = parseAbi([
    "function publish((bytes32 signatureHash, bytes32 defensePrimitive, uint16 confidence, bytes32 derivationProof, uint256 publishedAt))",
    "function isThreat(bytes32 signatureHash) view returns (bool)",
]);

export class SignaturePublisher {
    private rpcUrl: string;
    private registryAddress: Hex;
    private operatorKey: Hex;
    private publishedHashes = new Set<string>();

    constructor(rpcUrl: string, registryAddress: Hex, operatorKey: Hex) {
        this.rpcUrl = rpcUrl;
        this.registryAddress = registryAddress;
        this.operatorKey = operatorKey;
    }

    /**
     * Derive a threat signature from a defeated attack variant.
     * The signature hash is keccak256(pattern + victimProtocol + selector).
     */
    deriveSignature(variant: {
        pattern: string;
        victimProtocol: string;
        generation: number;
    }): ThreatSignature {
        const sigInput = `${variant.pattern}:${variant.victimProtocol}`;
        const signatureHash = keccak256(toHex(sigInput));

        return {
            signatureHash,
            defensePrimitive: "Pause",
            confidence: 9500,
            derivationProof: keccak256(toHex(`gen:${variant.generation}`)),
            sourceGeneration: variant.generation,
            pattern: variant.pattern,
        };
    }

    /**
     * Publish a signature to the ThreatRegistry on-chain.
     */
    async publishOnChain(sig: ThreatSignature): Promise<Hex | null> {
        if (this.publishedHashes.has(sig.signatureHash)) {
            log.debug({ hash: sig.signatureHash }, "signature already published, skipping");
            return null;
        }

        const account = privateKeyToAccount(this.operatorKey as Hex);
        const pub = createPublicClient({ transport: http(this.rpcUrl) });
        const wallet = createWalletClient({ account, transport: http(this.rpcUrl) });

        // Check if already on-chain
        const alreadyThreat = await pub.readContract({
            address: this.registryAddress,
            abi: THREAT_REGISTRY_ABI,
            functionName: "isThreat",
            args: [sig.signatureHash as Hex],
        });
        if (alreadyThreat) {
            this.publishedHashes.add(sig.signatureHash);
            return null;
        }

        try {
            const hash = await wallet.writeContract({
                address: this.registryAddress,
                abi: THREAT_REGISTRY_ABI,
                functionName: "publish",
                args: [
                    {
                        signatureHash: sig.signatureHash as Hex,
                        defensePrimitive: keccak256(toHex(sig.defensePrimitive)),
                        confidence: sig.confidence,
                        derivationProof: sig.derivationProof as Hex,
                        publishedAt: 0n, // contract sets this to block.timestamp
                    },
                ],
                chain: null,
            });
            await pub.waitForTransactionReceipt({ hash });
            this.publishedHashes.add(sig.signatureHash);
            log.info({ signatureHash: sig.signatureHash, txHash: hash }, "signature published on-chain");
            return hash;
        } catch (err: any) {
            // "exists" revert = already published by someone else
            if (err.message?.includes("exists")) {
                this.publishedHashes.add(sig.signatureHash);
                return null;
            }
            log.error({ err: err.message, sig: sig.signatureHash }, "failed to publish signature");
            return null;
        }
    }

    get publishedCount(): number {
        return this.publishedHashes.size;
    }
}
