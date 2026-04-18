import { describe, expect, it } from "vitest";
import { MempoolMatcher } from "./mempool-matcher.js";

describe("MempoolMatcher", () => {
    it("matches a transaction targeting a known protocol", () => {
        const matcher = new MempoolMatcher();
        matcher.addPattern("FLASH_LOAN_ORACLE_MANIP", "0xabcdef1234567890abcdef1234567890abcdef12");

        const result = matcher.matchTransaction({
            to: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
            data: "0x12345678",
            hash: "0xtx123",
        });
        expect(result).not.toBeNull();
        expect(result!.matched).toBe(true);
    });

    it("returns null for unknown targets", () => {
        const matcher = new MempoolMatcher();
        matcher.addPattern("FLASH_LOAN_ORACLE_MANIP", "0xabcdef1234567890abcdef1234567890abcdef12");

        const result = matcher.matchTransaction({
            to: "0x9999999999999999999999999999999999999999",
            data: "0x12345678",
            hash: "0xtx456",
        });
        expect(result).toBeNull();
    });

    it("tracks pattern count", () => {
        const matcher = new MempoolMatcher();
        expect(matcher.patternCount).toBe(0);
        matcher.addPattern("P1", "0x1111111111111111111111111111111111111111");
        matcher.addPattern("P2", "0x2222222222222222222222222222222222222222");
        expect(matcher.patternCount).toBe(2);
    });
});
