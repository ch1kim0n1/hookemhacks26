import { describe, expect, it } from "vitest";
import { type EventEnvelope, deriveTrustCues, redisChannelToKind } from "./cues.js";

function env(kind: string, data: unknown): EventEnvelope {
    return {
        channel: "",
        messageId: "m",
        emittedAt: "2026-04-15T00:00:00Z",
        kind,
        data,
    };
}

describe("deriveTrustCues", () => {
    it("emits AMBIGUITY on THREAT_CONFIRMED", () => {
        const cues = deriveTrustCues(
            env("THREAT_CONFIRMED", {
                eventId: "0x1",
                pattern: "FLASH_LOAN_ORACLE_MANIP",
            }),
        );
        expect(cues).toHaveLength(1);
        expect(cues[0].state).toBe("AMBIGUITY");
        expect(cues[0].eventId).toBe("0x1");
    });

    it("emits SUSPICION on DEFENSE_SUBMITTED", () => {
        const cues = deriveTrustCues(env("DEFENSE_SUBMITTED", { eventId: "0x1", txHash: "0xabc" }));
        expect(cues[0].state).toBe("SUSPICION");
        expect(cues[0].underlyingTxHash).toBe("0xabc");
    });

    it("emits PROOF_INJECTION + RESOLVED on DEFENSE_MINED", () => {
        const cues = deriveTrustCues(
            env("DEFENSE_MINED", {
                eventId: "0x1",
                txHash: "0xabc",
                blockNumber: 7,
                proofDigest: "0xd",
            }),
        );
        expect(cues.map((c) => c.state)).toEqual(["PROOF_INJECTION", "RESOLVED"]);
    });

    it("emits REJECTED on DEFENSE_REJECTED with the revert reason", () => {
        const cues = deriveTrustCues(
            env("DEFENSE_REJECTED", {
                eventId: "0x1",
                reason: "INVALID_PROOF",
                pattern: "OPERATOR_OVERRIDE",
                revertReason: "PolicyRegistry: invalid proof",
            }),
        );
        expect(cues).toHaveLength(1);
        expect(cues[0].state).toBe("REJECTED");
        expect(cues[0].reason).toBe("INVALID_PROOF");
        expect(cues[0].revertReason).toBe("PolicyRegistry: invalid proof");
    });

    it("returns empty cues for unrelated events", () => {
        const cues = deriveTrustCues(env("PENDING_TX", { foo: "bar" }));
        expect(cues).toEqual([]);
    });
});

describe("redisChannelToKind", () => {
    it("maps known channels", () => {
        expect(redisChannelToKind("sentinel.defense.rejected")).toBe("DEFENSE_REJECTED");
        expect(redisChannelToKind("sentinel.counterfactual.ready")).toBe("COUNTERFACTUAL_READY");
    });

    it("maps training telemetry channel", () => {
        expect(redisChannelToKind("sentinel.training.telemetry")).toBe("TRAINING_TELEMETRY");
    });

    it("maps preemptive channels", () => {
        expect(redisChannelToKind("sentinel.preemptive.signature")).toBe("PREEMPTIVE_SIGNATURE");
        expect(redisChannelToKind("sentinel.preemptive.executed")).toBe("PREEMPTIVE_EXECUTED");
        expect(redisChannelToKind("sentinel.preemptive.alert")).toBe("PREEMPTIVE_ALERT");
    });

    it("uppercases unknown channels as fallback", () => {
        expect(redisChannelToKind("sentinel.wat")).toBe("SENTINEL.WAT");
    });
});
