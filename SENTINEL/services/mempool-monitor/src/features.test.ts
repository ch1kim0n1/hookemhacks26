import { describe, expect, it } from "vitest";
import { type MonitorConfig, extractFeatures } from "./features.js";

const FLASH = "0xAaAa000000000000000000000000000000000001";
const VICTIM = "0xBbBb000000000000000000000000000000000002";

function fakeTx(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        hash: "0xdeadbeef",
        from: "0xFromFromFromFromFromFromFromFromFromFrom",
        to: FLASH,
        value: 0n,
        gasPrice: 1n,
        gasLimit: 21000n,
        nonce: 7,
        data: "0xa9059cbb00",
        ...overrides,
    } as any;
}

describe("extractFeatures", () => {
    const cfg: MonitorConfig = {
        flashLoanProviders: new Set([FLASH.toLowerCase()]),
        protectedProtocols: new Set([VICTIM.toLowerCase()]),
    };

    it("flags flash loan origination", () => {
        const f = extractFeatures(fakeTx(), cfg);
        expect(f.isFlashLoanOrigin).toBe(true);
        expect(f.selector).toBe("0xa9059cbb");
    });

    it("flags protected-protocol calls", () => {
        const f = extractFeatures(fakeTx({ to: VICTIM }), cfg);
        expect(f.involvesProtectedProtocol).toBe(true);
        expect(f.isFlashLoanOrigin).toBe(false);
    });

    it("tolerates empty calldata", () => {
        const f = extractFeatures(fakeTx({ to: "0x00", data: "0x" }), cfg);
        expect(f.selector).toBe("0x");
    });
});
