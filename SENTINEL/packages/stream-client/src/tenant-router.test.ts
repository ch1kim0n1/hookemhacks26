import { describe, expect, it } from "vitest";
import { TenantStreamRouter } from "./tenant-router.js";

describe("TenantStreamRouter", () => {
    it("default tenant uses bare stream names", () => {
        const router = new TenantStreamRouter("default");
        expect(router.resolve("sentinel.mempool.pending")).toBe("sentinel.mempool.pending");
        expect(router.resolveGroup("detection-engine")).toBe("detection-engine");
    });

    it("empty slug uses bare stream names", () => {
        const router = new TenantStreamRouter("");
        expect(router.resolve("sentinel.mempool.pending")).toBe("sentinel.mempool.pending");
    });

    it("non-default tenant prefixes stream names", () => {
        const router = new TenantStreamRouter("acme-corp");
        expect(router.resolve("sentinel.mempool.pending")).toBe("acme-corp.sentinel.mempool.pending");
        expect(router.resolveGroup("detection-engine")).toBe("acme-corp-detection-engine");
    });
});
