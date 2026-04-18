import { describe, expect, it } from "vitest";
import { SignaturePublisher } from "./signature-publisher.js";

describe("SignaturePublisher", () => {
    it("derives a deterministic signature hash", () => {
        const pub = new SignaturePublisher("http://localhost:8545", "0x1" as any, "0x1" as any);
        const sig1 = pub.deriveSignature({ pattern: "FLASH_LOAN", victimProtocol: "0xabc", generation: 1 });
        const sig2 = pub.deriveSignature({ pattern: "FLASH_LOAN", victimProtocol: "0xabc", generation: 2 });
        // Same pattern+protocol = same signature hash
        expect(sig1.signatureHash).toBe(sig2.signatureHash);
        // Different derivation proofs (different generations)
        expect(sig1.derivationProof).not.toBe(sig2.derivationProof);
    });

    it("different patterns produce different hashes", () => {
        const pub = new SignaturePublisher("http://localhost:8545", "0x1" as any, "0x1" as any);
        const sig1 = pub.deriveSignature({ pattern: "FLASH_LOAN", victimProtocol: "0xabc", generation: 1 });
        const sig2 = pub.deriveSignature({ pattern: "REENTRANCY", victimProtocol: "0xabc", generation: 1 });
        expect(sig1.signatureHash).not.toBe(sig2.signatureHash);
    });
});
