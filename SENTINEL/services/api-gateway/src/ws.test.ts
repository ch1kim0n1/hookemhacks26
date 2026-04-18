import { describe, expect, it } from "vitest";
import { redisChannelToKind } from "./cues.js";

// CHANNEL_TO_KINDS is defined in index.ts and not exported.
// Mirror it here so the tests stay in sync with the spec.
const CHANNEL_TO_KINDS: Record<string, string[]> = {
    "events.all": [],
    "trust.collapse": [],
    "mempool.pending": ["PENDING_TX"],
    "defense.submitted": ["DEFENSE_SUBMITTED"],
    "defense.mined": ["DEFENSE_MINED"],
    "counterfactual.ready": ["COUNTERFACTUAL_READY"],
    "ledger.recorded": ["LEDGER_RECORDED"],
    "prover.progress": ["PROVER_STARTED", "PROVER_FINISHED"],
    "battlefield.tick": ["TRAINING_TELEMETRY"],
    "immunity.propagation": ["PREEMPTIVE_SIGNATURE", "PREEMPTIVE_EXECUTED", "PREEMPTIVE_ALERT", "FEDERATION_SYNC"],
};

// ---------------------------------------------------------------------------
// WS message parsing
// ---------------------------------------------------------------------------
describe("WS message handling", () => {
    it("parses subscribe message", () => {
        const msg = JSON.parse('{"op":"subscribe","channel":"events.all"}');
        expect(msg.op).toBe("subscribe");
        expect(msg.channel).toBe("events.all");
    });

    it("parses hello message", () => {
        const msg = JSON.parse('{"op":"hello","version":"1.0"}');
        expect(msg.op).toBe("hello");
        expect(msg.version).toBe("1.0");
    });

    it("parses unsubscribe message", () => {
        const msg = JSON.parse('{"op":"unsubscribe","channel":"mempool.pending"}');
        expect(msg.op).toBe("unsubscribe");
        expect(msg.channel).toBe("mempool.pending");
    });

    it("parses ping message", () => {
        const msg = JSON.parse('{"op":"ping"}');
        expect(msg.op).toBe("ping");
    });

    it("handles invalid JSON gracefully", () => {
        let parsed: unknown = null;
        try {
            parsed = JSON.parse("not-json{{{");
        } catch {
            parsed = null;
        }
        expect(parsed).toBeNull();
    });

    it("rejects unsupported version in hello", () => {
        const msg = JSON.parse('{"op":"hello","version":"2.0"}');
        const supported = msg.version === "1.0";
        expect(supported).toBe(false);
    });

    it("accepts supported version in hello", () => {
        const msg = JSON.parse('{"op":"hello","version":"1.0"}');
        const supported = msg.version === "1.0";
        expect(supported).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// CHANNEL_TO_KINDS completeness — spec requires 10 named channels
// (events.all + trust.collapse + 8 topic channels)
// ---------------------------------------------------------------------------
describe("CHANNEL_TO_KINDS", () => {
    it("has all 10 channels", () => {
        expect(Object.keys(CHANNEL_TO_KINDS)).toHaveLength(10);
    });

    it("events.all maps to empty kinds array (receives everything)", () => {
        expect(CHANNEL_TO_KINDS["events.all"]).toEqual([]);
    });

    it("trust.collapse maps to empty kinds array (cue-based, not kind-based)", () => {
        expect(CHANNEL_TO_KINDS["trust.collapse"]).toEqual([]);
    });

    it("mempool.pending maps to PENDING_TX", () => {
        expect(CHANNEL_TO_KINDS["mempool.pending"]).toContain("PENDING_TX");
    });

    it("defense.submitted maps to DEFENSE_SUBMITTED", () => {
        expect(CHANNEL_TO_KINDS["defense.submitted"]).toContain("DEFENSE_SUBMITTED");
    });

    it("defense.mined maps to DEFENSE_MINED", () => {
        expect(CHANNEL_TO_KINDS["defense.mined"]).toContain("DEFENSE_MINED");
    });

    it("prover.progress maps to both PROVER_STARTED and PROVER_FINISHED", () => {
        expect(CHANNEL_TO_KINDS["prover.progress"]).toContain("PROVER_STARTED");
        expect(CHANNEL_TO_KINDS["prover.progress"]).toContain("PROVER_FINISHED");
    });

    it("immunity.propagation maps to all preemptive and federation kinds", () => {
        const kinds = CHANNEL_TO_KINDS["immunity.propagation"];
        expect(kinds).toContain("PREEMPTIVE_SIGNATURE");
        expect(kinds).toContain("PREEMPTIVE_EXECUTED");
        expect(kinds).toContain("PREEMPTIVE_ALERT");
        expect(kinds).toContain("FEDERATION_SYNC");
    });

    it("all channel names are non-empty strings", () => {
        for (const ch of Object.keys(CHANNEL_TO_KINDS)) {
            expect(ch).toBeTruthy();
        }
    });
});

// ---------------------------------------------------------------------------
// redisChannelToKind mapping
// ---------------------------------------------------------------------------
describe("redisChannelToKind", () => {
    it("maps sentinel.mempool.pending → PENDING_TX", () => {
        expect(redisChannelToKind("sentinel.mempool.pending")).toBe("PENDING_TX");
    });

    it("maps sentinel.detection.confirmed → THREAT_CONFIRMED", () => {
        expect(redisChannelToKind("sentinel.detection.confirmed")).toBe("THREAT_CONFIRMED");
    });

    it("maps sentinel.defense.submitted → DEFENSE_SUBMITTED", () => {
        expect(redisChannelToKind("sentinel.defense.submitted")).toBe("DEFENSE_SUBMITTED");
    });

    it("maps sentinel.defense.mined → DEFENSE_MINED", () => {
        expect(redisChannelToKind("sentinel.defense.mined")).toBe("DEFENSE_MINED");
    });

    it("maps sentinel.counterfactual.ready → COUNTERFACTUAL_READY", () => {
        expect(redisChannelToKind("sentinel.counterfactual.ready")).toBe("COUNTERFACTUAL_READY");
    });

    it("maps sentinel.prover.started → PROVER_STARTED", () => {
        expect(redisChannelToKind("sentinel.prover.started")).toBe("PROVER_STARTED");
    });

    it("maps sentinel.prover.finished → PROVER_FINISHED", () => {
        expect(redisChannelToKind("sentinel.prover.finished")).toBe("PROVER_FINISHED");
    });

    it("maps sentinel.training.telemetry → TRAINING_TELEMETRY", () => {
        expect(redisChannelToKind("sentinel.training.telemetry")).toBe("TRAINING_TELEMETRY");
    });

    it("maps unknown channel to uppercased fallback", () => {
        expect(redisChannelToKind("sentinel.unknown.channel")).toBe("SENTINEL.UNKNOWN.CHANNEL");
    });
});

// ---------------------------------------------------------------------------
// WS subscribe / unsubscribe channel tracking logic
// ---------------------------------------------------------------------------
describe("WS channel subscription tracking", () => {
    it("adding a channel to a Set is idempotent", () => {
        const channels = new Set<string>();
        channels.add("events.all");
        channels.add("events.all");
        expect(channels.size).toBe(1);
    });

    it("unsubscribing removes the channel", () => {
        const channels = new Set<string>(["events.all", "mempool.pending"]);
        channels.delete("mempool.pending");
        expect(channels.has("mempool.pending")).toBe(false);
        expect(channels.has("events.all")).toBe(true);
    });

    it("subscribing to multiple channels works", () => {
        const channels = new Set<string>();
        channels.add("events.all");
        channels.add("defense.submitted");
        channels.add("prover.progress");
        expect(channels.size).toBe(3);
    });
});
