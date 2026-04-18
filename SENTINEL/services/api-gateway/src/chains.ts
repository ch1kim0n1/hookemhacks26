import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger.js";

export interface ChainConfig {
    chainId: number;
    name: string;
    rpcUrl: string;
    wsUrl?: string;
    addresses: Record<string, string>;
}

/**
 * Load chain configurations from config/addresses.{network}.json files.
 * Falls back to addresses.local.json for the default chain.
 */
export function loadChainConfigs(configDir: string): ChainConfig[] {
    const chains: ChainConfig[] = [];

    // Default local chain (Anvil)
    const localPath = join(configDir, "addresses.local.json");
    if (existsSync(localPath)) {
        const addresses = JSON.parse(readFileSync(localPath, "utf-8"));
        chains.push({
            chainId: 31337,
            name: "anvil-local",
            rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
            wsUrl: process.env.WS_URL ?? "ws://127.0.0.1:8545",
            addresses,
        });
    }

    // Load additional chain configs (addresses.{network}.json)
    const networks = ["mainnet", "goerli", "sepolia", "arbitrum", "optimism", "polygon"];
    for (const network of networks) {
        const path = join(configDir, `addresses.${network}.json`);
        if (existsSync(path)) {
            try {
                const data = JSON.parse(readFileSync(path, "utf-8"));
                chains.push({
                    chainId: data.chainId ?? 0,
                    name: network,
                    rpcUrl: data.rpcUrl ?? "",
                    wsUrl: data.wsUrl,
                    addresses: data.addresses ?? data,
                });
                log.info({ network, chainId: data.chainId }, "loaded chain config");
            } catch (err) {
                log.error({ network, err }, "failed to load chain config");
            }
        }
    }

    log.info({ chainCount: chains.length, names: chains.map((c) => c.name) }, "chain configs loaded");
    return chains;
}

/**
 * Find a chain config by chain ID.
 */
export function getChainByChainId(chains: ChainConfig[], chainId: number): ChainConfig | undefined {
    return chains.find((c) => c.chainId === chainId);
}

/**
 * Find a chain config by name.
 */
export function getChainByName(chains: ChainConfig[], name: string): ChainConfig | undefined {
    return chains.find((c) => c.name === name);
}
