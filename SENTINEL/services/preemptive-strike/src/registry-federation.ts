import type { StreamPublisher } from "@sentinel/stream-client";
import { http, type Hex, createPublicClient, parseAbi } from "viem";
import { log } from "./logger.js";

const THREAT_REGISTRY_ABI = parseAbi([
    "function getAll() view returns (bytes32[])",
    "function isThreat(bytes32) view returns (bool)",
    "function get(bytes32) view returns ((bytes32 signatureHash, bytes32 defensePrimitive, uint16 confidence, bytes32 derivationProof, uint256 publishedAt))",
]);

export interface FederatedRegistry {
    chainId: number;
    chainName: string;
    registryAddress: Hex;
    rpcUrl: string;
}

/**
 * Federates threat signatures across multiple chain deployments.
 * Periodically syncs signatures from remote registries to the local one.
 */
export class RegistryFederation {
    private registries: FederatedRegistry[];
    private streamPub: StreamPublisher;
    private syncedHashes = new Set<string>();

    constructor(registries: FederatedRegistry[], streamPub: StreamPublisher) {
        this.registries = registries;
        this.streamPub = streamPub;
    }

    /**
     * Sync all signatures from remote registries.
     * Returns newly discovered signature hashes.
     */
    async syncAll(): Promise<string[]> {
        const newHashes: string[] = [];

        for (const reg of this.registries) {
            try {
                const client = createPublicClient({ transport: http(reg.rpcUrl) });
                const allHashes = (await client.readContract({
                    address: reg.registryAddress,
                    abi: THREAT_REGISTRY_ABI,
                    functionName: "getAll",
                })) as Hex[];

                for (const hash of allHashes) {
                    const key = `${reg.chainId}:${hash}`;
                    if (!this.syncedHashes.has(key)) {
                        // Check if still active (not expired)
                        const isActive = await client.readContract({
                            address: reg.registryAddress,
                            abi: THREAT_REGISTRY_ABI,
                            functionName: "isThreat",
                            args: [hash],
                        });

                        if (isActive) {
                            this.syncedHashes.add(key);
                            newHashes.push(hash);

                            await this.streamPub.publish("sentinel.federation.sync", {
                                schema: "FederationSyncEvent@1",
                                signatureHash: hash,
                                sourceChainId: reg.chainId,
                                sourceChainName: reg.chainName,
                                timestamp: new Date().toISOString(),
                            });

                            log.info(
                                {
                                    hash: hash.slice(0, 10) + "...",
                                    source: reg.chainName,
                                },
                                "federated signature synced",
                            );
                        }
                    }
                }
            } catch (err: any) {
                log.error({ chain: reg.chainName, err: err.message }, "federation sync failed");
            }
        }

        return newHashes;
    }

    /**
     * Start periodic sync (every intervalMs).
     */
    startPeriodicSync(intervalMs = 30000): NodeJS.Timeout {
        return setInterval(() => {
            this.syncAll().catch((err) => {
                log.error({ err: err.message }, "periodic federation sync failed");
            });
        }, intervalMs);
    }

    get syncedCount(): number {
        return this.syncedHashes.size;
    }
}
