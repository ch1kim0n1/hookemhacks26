import type { FastifyInstance } from "fastify";
import { http, type Hex, createPublicClient, parseAbi } from "viem";

const THREAT_REGISTRY_ABI = parseAbi([
    "function getAll() view returns (bytes32[])",
    "function get(bytes32) view returns ((bytes32 signatureHash, bytes32 defensePrimitive, uint16 confidence, bytes32 derivationProof, uint256 publishedAt))",
    "function isThreat(bytes32) view returns (bool)",
    "function activeCount() view returns (uint256)",
]);

export async function registerThreatRoutes(
    app: FastifyInstance,
    rpcUrl: string,
    addresses: Record<string, string>,
): Promise<void> {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const registryAddr = addresses.ThreatRegistry as Hex;

    if (!registryAddr) return; // No ThreatRegistry deployed

    app.get("/api/v1/threats/registry", async () => {
        const hashes = (await client.readContract({
            address: registryAddr,
            abi: THREAT_REGISTRY_ABI,
            functionName: "getAll",
        })) as Hex[];

        const activeCount = await client.readContract({
            address: registryAddr,
            abi: THREAT_REGISTRY_ABI,
            functionName: "activeCount",
        });

        return {
            signatures: hashes,
            total: hashes.length,
            active: Number(activeCount),
        };
    });

    app.get<{ Params: { signatureHash: string } }>("/api/v1/threats/registry/:signatureHash", async (req, reply) => {
        const hash = req.params.signatureHash as Hex;
        try {
            const sig = (await client.readContract({
                address: registryAddr,
                abi: THREAT_REGISTRY_ABI,
                functionName: "get",
                args: [hash],
            })) as any;

            const isActive = await client.readContract({
                address: registryAddr,
                abi: THREAT_REGISTRY_ABI,
                functionName: "isThreat",
                args: [hash],
            });

            if (sig[0] === "0x0000000000000000000000000000000000000000000000000000000000000000") {
                reply.code(404);
                return { error: "signature not found" };
            }

            return {
                signatureHash: sig[0],
                defensePrimitive: sig[1],
                confidence: Number(sig[2]),
                derivationProof: sig[3],
                publishedAt: Number(sig[4]),
                active: isActive,
            };
        } catch (err: any) {
            reply.code(500);
            return { error: err.message };
        }
    });
}
