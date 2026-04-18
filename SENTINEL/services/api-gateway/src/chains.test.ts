import { describe, expect, it } from "vitest";
import { type ChainConfig, getChainByChainId, getChainByName, loadChainConfigs } from "./chains.js";

const CHAINS: ChainConfig[] = [
    { chainId: 31337, name: "anvil-local", rpcUrl: "http://localhost:8545", addresses: { A: "0x1" } },
    { chainId: 1, name: "mainnet", rpcUrl: "https://rpc.mainnet.org", addresses: { B: "0x2" } },
];

describe("chains", () => {
    it("getChainByChainId finds the right chain", () => {
        expect(getChainByChainId(CHAINS, 31337)?.name).toBe("anvil-local");
        expect(getChainByChainId(CHAINS, 999)).toBeUndefined();
    });

    it("getChainByName finds the right chain", () => {
        expect(getChainByName(CHAINS, "mainnet")?.chainId).toBe(1);
        expect(getChainByName(CHAINS, "unknown")).toBeUndefined();
    });

    it("loadChainConfigs loads at least the local chain", () => {
        const chains = loadChainConfigs("../../config");
        expect(chains.length).toBeGreaterThanOrEqual(1);
        expect(chains[0].chainId).toBe(31337);
    });
});
