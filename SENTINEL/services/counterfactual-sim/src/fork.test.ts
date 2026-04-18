import { describe, expect, it } from "vitest";
import { acquirePort, releasePort } from "./fork.js";

describe("fork port pool", () => {
    it("returns distinct ports under concurrent acquisition", async () => {
        const ports = await Promise.all(Array.from({ length: 16 }, () => acquirePort()));
        const unique = new Set(ports);
        expect(unique.size).toBe(ports.length);
        for (const p of ports) releasePort(p);
    });

    it("recycles ports after release", async () => {
        const first = await acquirePort();
        releasePort(first);
        const second = await acquirePort();
        // Should be allocatable again (may be same or different port — key is no throw).
        expect(second).toBeGreaterThan(0);
        releasePort(second);
    });

    it("ports fall inside configured pool range", async () => {
        const start = Number(process.env.ANVIL_PORT_POOL_START ?? 28545);
        const end = Number(process.env.ANVIL_PORT_POOL_END ?? 28999);
        const p = await acquirePort();
        expect(p).toBeGreaterThanOrEqual(start);
        expect(p).toBeLessThanOrEqual(end);
        releasePort(p);
    });
});
