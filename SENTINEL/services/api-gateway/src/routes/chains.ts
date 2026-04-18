import type { FastifyInstance } from "fastify";
import { type ChainConfig, loadChainConfigs } from "../chains.js";

export async function registerChainRoutes(app: FastifyInstance, configDir: string): Promise<ChainConfig[]> {
    const chains = loadChainConfigs(configDir);

    // List available chains
    app.get("/api/v1/chains", async () => {
        return {
            chains: chains.map((c) => ({
                chainId: c.chainId,
                name: c.name,
                rpcUrl: c.rpcUrl,
                contractCount: Object.keys(c.addresses).length,
            })),
        };
    });

    // Get addresses for a specific chain
    app.get<{ Params: { chainId: string } }>("/api/v1/chains/:chainId/addresses", async (req, reply) => {
        const chainId = Number.parseInt(req.params.chainId, 10);
        const chain = chains.find((c) => c.chainId === chainId);
        if (!chain) {
            reply.code(404);
            return { error: "chain not found" };
        }
        return { chainId: chain.chainId, name: chain.name, addresses: chain.addresses };
    });

    return chains;
}
