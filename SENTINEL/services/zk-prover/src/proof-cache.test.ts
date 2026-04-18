/**
 * Tests for the L1 proof cache (the pure in-memory path). L2 (Postgres) is
 * covered by integration tests elsewhere since it requires a live DB.
 *
 * These tests focus on the L1 hot path because it's what shields the demo
 * from multi-second proof latency on the replay flow: a miss here cascades
 * into a 30-60s Groth16 prove.
 */

import { describe, expect, it } from "vitest";
import { type CachedProof, ProofCache, inputKey } from "./proof-cache.js";

function makeProof(overrides: Partial<CachedProof> = {}): CachedProof {
    return {
        proof: "0xdeadbeef",
        publicInputs: ["0x01", "0x02"],
        imageId: "0xabc",
        journal: "0xbabe",
        elapsedMs: 42,
        circuit: "policy-compliance",
        cached: false,
        ...overrides,
    };
}

describe("inputKey", () => {
    it("is deterministic for identical inputs", () => {
        const a = inputKey({ x: 1, y: 2 });
        const b = inputKey({ x: 1, y: 2 });
        expect(a).toBe(b);
        expect(a).toHaveLength(64); // sha256 hex
    });

    it("differs on any input change", () => {
        expect(inputKey({ x: 1 })).not.toBe(inputKey({ x: 2 }));
        expect(inputKey({ x: 1 })).not.toBe(inputKey({ y: 1 }));
    });

    it("depends on field ordering (JSON.stringify is order-sensitive)", () => {
        // This is a documented property: if callers want order-independence
        // they must canonicalize before hashing.
        const a = inputKey({ x: 1, y: 2 });
        const b = inputKey({ y: 2, x: 1 });
        expect(a).not.toBe(b);
    });
});

describe("ProofCache (L1 only — no Postgres)", () => {
    it("returns null on miss", async () => {
        const cache = new ProofCache(undefined);
        const hit = await cache.get("policy-compliance", "doesntexist");
        expect(hit).toBeNull();
    });

    it("round-trips a set/get and marks it cached", async () => {
        const cache = new ProofCache(undefined);
        await cache.set("policy-compliance", "abc", makeProof());
        const hit = await cache.get("policy-compliance", "abc");
        expect(hit).not.toBeNull();
        expect(hit!.cached).toBe(true);
        expect(hit!.proof).toBe("0xdeadbeef");
    });

    it("isolates entries by circuit", async () => {
        const cache = new ProofCache(undefined);
        await cache.set("policy-compliance", "shared-hash", makeProof({ proof: "0xpolicy" }));
        await cache.set("counterfactual-correctness", "shared-hash", makeProof({ proof: "0xctrfact" }));
        const a = await cache.get("policy-compliance", "shared-hash");
        const b = await cache.get("counterfactual-correctness", "shared-hash");
        expect(a!.proof).toBe("0xpolicy");
        expect(b!.proof).toBe("0xctrfact");
    });

    it("overwrites a prior entry when set is called again", async () => {
        const cache = new ProofCache(undefined);
        await cache.set("policy-compliance", "x", makeProof({ proof: "0x1" }));
        await cache.set("policy-compliance", "x", makeProof({ proof: "0x2" }));
        const hit = await cache.get("policy-compliance", "x");
        expect(hit!.proof).toBe("0x2");
    });

    it("reports hasL2 = false when no Postgres URL is provided", () => {
        const cache = new ProofCache(undefined);
        expect(cache.hasL2).toBe(false);
    });

    it("enforces an LRU eviction bound of 512 entries", async () => {
        const cache = new ProofCache(undefined);
        // Fill past the bound.
        for (let i = 0; i < 600; i++) {
            await cache.set("policy-compliance", `hash-${i}`, makeProof());
        }
        expect(cache.l1Size).toBeLessThanOrEqual(512);

        // The oldest entries should have been evicted.
        const oldest = await cache.get("policy-compliance", "hash-0");
        expect(oldest).toBeNull();
        // A recent entry should still be hot.
        const recent = await cache.get("policy-compliance", "hash-599");
        expect(recent).not.toBeNull();
    });

    it("refreshes LRU ordering on get — re-touching keeps an entry hot", async () => {
        const cache = new ProofCache(undefined);
        await cache.set("policy-compliance", "pinned", makeProof({ proof: "0xPIN" }));

        // Interleave the pinned get with fills so it stays the newest key.
        for (let i = 0; i < 600; i++) {
            await cache.set("policy-compliance", `hash-${i}`, makeProof());
            if (i % 10 === 0) await cache.get("policy-compliance", "pinned");
        }
        // Touch once more so it's clearly freshest.
        await cache.get("policy-compliance", "pinned");

        // Add one more entry past the bound — the oldest still-untouched
        // entry should be evicted, not pinned.
        await cache.set("policy-compliance", "new-after", makeProof());

        const pinned = await cache.get("policy-compliance", "pinned");
        expect(pinned).not.toBeNull();
        expect(pinned!.proof).toBe("0xPIN");
    });

    it("close() is a no-op when there is no L2", async () => {
        const cache = new ProofCache(undefined);
        await expect(cache.close()).resolves.toBeUndefined();
    });
});
