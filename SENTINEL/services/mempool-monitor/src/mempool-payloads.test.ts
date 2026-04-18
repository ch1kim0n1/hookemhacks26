import { describe, expect, it } from "vitest";
import type { TxFeatures } from "./features.js";
import {
    STREAM_MEMPOOL_BLOCK,
    STREAM_MEMPOOL_PENDING,
    buildBlockEnvelope,
    buildPendingTxEnvelope,
} from "./mempool-payloads.js";

const sampleFeatures = (): TxFeatures => ({
    hash: "0xabc",
    from: "0xfrom",
    to: "0xto",
    value: "0",
    gasPrice: "1",
    gasLimit: "21000",
    nonce: 0,
    selector: "0x12345678",
    decodedArgs: null,
    isFlashLoanOrigin: false,
    involvesProtectedProtocol: false,
    callGraphDepth: 1,
    timestamp: 1_700_000_000_000,
});

describe("mempool-payloads", () => {
    it("uses doc 03 stream names", () => {
        expect(STREAM_MEMPOOL_PENDING).toBe("sentinel.mempool.pending");
        expect(STREAM_MEMPOOL_BLOCK).toBe("sentinel.mempool.block");
    });

    it("buildPendingTxEnvelope matches PendingTxEvent@1 schema", () => {
        const f = sampleFeatures();
        const env = buildPendingTxEnvelope(f);
        expect(env.schema).toBe("PendingTxEvent@1");
        expect(env.tx).toBe(f);
        expect(env.observedAt).toBe(new Date(f.timestamp).toISOString());
    });

    it("buildBlockEnvelope matches BlockEvent@1 schema", () => {
        const d = new Date("2026-04-16T12:00:00.000Z");
        const env = buildBlockEnvelope(12_345, d);
        expect(env.schema).toBe("BlockEvent@1");
        expect(env.blockNumber).toBe(12_345);
        expect(env.observedAt).toBe(d.toISOString());
    });
});
