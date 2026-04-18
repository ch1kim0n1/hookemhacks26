import { describe, expect, it } from "vitest";
import { type Balance, diff } from "./delta.js";
import { computeRoot } from "./merkle.js";

describe("merkle.computeRoot", () => {
    it("returns a deterministic 32-byte root for a fixed leaf set", () => {
        const leaves = [
            {
                address: "0x00000000000000000000000000000000000000aa" as `0x${string}`,
                label: "a",
                realWei: "100",
                shadowWei: "50",
                deltaWei: "-50",
            },
            {
                address: "0x00000000000000000000000000000000000000bb" as `0x${string}`,
                label: "b",
                realWei: "0",
                shadowWei: "200",
                deltaWei: "200",
            },
        ];
        const r = computeRoot(leaves);
        expect(r).toMatch(/^0x[0-9a-f]{64}$/);
        expect(computeRoot(leaves)).toBe(r); // stable
    });

    it("returns the zero root for empty leaves", () => {
        expect(computeRoot([])).toBe("0x" + "00".repeat(32));
    });

    it("handles odd leaf counts by duplicating the last", () => {
        const leaves = [
            {
                address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
                label: "a",
                realWei: "0",
                shadowWei: "0",
                deltaWei: "0",
            },
            {
                address: "0x0000000000000000000000000000000000000002" as `0x${string}`,
                label: "b",
                realWei: "0",
                shadowWei: "0",
                deltaWei: "0",
            },
            {
                address: "0x0000000000000000000000000000000000000003" as `0x${string}`,
                label: "c",
                realWei: "0",
                shadowWei: "0",
                deltaWei: "0",
            },
        ];
        const r = computeRoot(leaves);
        expect(r).toMatch(/^0x[0-9a-f]{64}$/);
    });
});

describe("delta.diff", () => {
    it("sums victim-prefixed losses into totalDeltaWei", () => {
        const real: Balance[] = [
            {
                address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
                label: "victim.wethReserve",
                balanceWei: 1_000n,
            },
            {
                address: "0x0000000000000000000000000000000000000002" as `0x${string}`,
                label: "attacker.wethBalance",
                balanceWei: 0n,
            },
        ];
        const shadow: Balance[] = [
            {
                address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
                label: "victim.wethReserve",
                balanceWei: 600n,
            },
            {
                address: "0x0000000000000000000000000000000000000002" as `0x${string}`,
                label: "attacker.wethBalance",
                balanceWei: 400n,
            },
        ];
        const a = diff(real, shadow);
        const b = diff(real, shadow);
        expect(a).toEqual(b);
        expect(a.totalDeltaWei).toBe(400n); // 1000 - 600 victim loss
        expect(a.leaves).toHaveLength(2);
        expect(a.leaves[0].deltaWei).toBe("-400");
        expect(a.leaves[1].deltaWei).toBe("400");
    });

    it("skips labels that appear only in shadow", () => {
        const real: Balance[] = [
            {
                address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
                label: "victim.wethReserve",
                balanceWei: 1_000n,
            },
        ];
        const shadow: Balance[] = [
            {
                address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
                label: "victim.wethReserve",
                balanceWei: 500n,
            },
            {
                address: "0x0000000000000000000000000000000000000002" as `0x${string}`,
                label: "attacker.wethBalance",
                balanceWei: 500n,
            },
        ];
        const { leaves, totalDeltaWei } = diff(real, shadow);
        expect(leaves).toHaveLength(1);
        expect(totalDeltaWei).toBe(500n);
    });
});
