import { describe, expect, it } from "vitest";
import { type FederatedRegistry, RegistryFederation } from "./registry-federation.js";

describe("RegistryFederation", () => {
    it("starts with zero synced hashes", () => {
        // Mock streamPub
        const mockPub = { publish: async () => "id" } as any;
        const federation = new RegistryFederation([], mockPub);
        expect(federation.syncedCount).toBe(0);
    });

    it("syncAll returns empty for no registries", async () => {
        const mockPub = { publish: async () => "id" } as any;
        const federation = new RegistryFederation([], mockPub);
        const result = await federation.syncAll();
        expect(result).toEqual([]);
    });
});
