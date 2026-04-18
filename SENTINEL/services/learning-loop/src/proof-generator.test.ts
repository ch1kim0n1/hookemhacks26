import { describe, expect, it } from "vitest";
import { generateLearningProof } from "./proof-generator.js";

describe("generateLearningProof", () => {
    it("produces a non-empty proof with valid public inputs", async () => {
        const proof = await generateLearningProof({
            oldPolicyHash: "0x" + "ab".repeat(32),
            newPolicyJson: '{"version":"2.0"}',
            generationCount: 10,
            winRate: 0.95,
        });
        expect(proof.proofHex.length).toBeGreaterThan(10);
        expect(proof.publicInputs).toHaveLength(4);
        expect(proof.publicInputs[0]).toBe("0x" + "ab".repeat(32)); // old hash passthrough
        expect(proof.publicInputs[1]).toMatch(/^0x[0-9a-f]{64}$/); // new hash = sha256
        expect(proof.publicInputs[2]).toMatch(/^0x[0-9a-f]{64}$/); // winRateBp
        expect(proof.publicInputs[3]).toMatch(/^0x[0-9a-f]{64}$/); // generationCount
        expect(proof.generationCount).toBe(10);
        expect(proof.winRate).toBe(0.95);
    });

    it("produces deterministic proofs for same inputs", async () => {
        const input = {
            oldPolicyHash: "0x" + "cd".repeat(32),
            newPolicyJson: '{"test":true}',
            generationCount: 5,
            winRate: 0.9,
        };
        const proof1 = await generateLearningProof(input);
        const proof2 = await generateLearningProof(input);
        expect(proof1.proofHex).toBe(proof2.proofHex);
        expect(proof1.publicInputs).toEqual(proof2.publicInputs);
    });
});
