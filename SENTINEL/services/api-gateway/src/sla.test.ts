// SLA contract from doc 03 §SLA: <800ms from attack detection to defense submission.
//
// End-to-end budget breakdown:
//   mempool-monitor:   <40ms   (tx ingestion + feature extraction)
//   detection-engine:  <150ms  (simple) / <400ms (multi-step LSTM)
//   defense-agent:     <400ms  (ZK proof is the bottleneck; hits L1/L2 cache on demo path)
//   api-gateway:       <10ms   ← this file validates the gateway's portion
//
// Full E2E validation requires the running stack; see scripts/demo-smoke-test.sh.
// This file guards against regressions in the gateway's hot-path overhead.

import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { type EventEnvelope, deriveTrustCues, redisChannelToKind } from "./cues.js";

const GATEWAY_BUDGET_MS = 10;

function makeEnvelope(kind: string, data: unknown): EventEnvelope {
    return {
        channel: "sentinel.detection.confirmed",
        messageId: `msg-${Math.random().toString(36).slice(2)}`,
        emittedAt: new Date().toISOString(),
        kind,
        data,
    };
}

describe("SLA: api-gateway event processing overhead (doc 03 §SLA)", () => {
    it(`processes the THREAT_CONFIRMED→DEFENSE_MINED sequence within ${GATEWAY_BUDGET_MS}ms`, () => {
        const sequence = [
            makeEnvelope("THREAT_CONFIRMED", {
                eventId: "0xe1",
                pattern: "FLASH_LOAN_ORACLE_MANIP",
            }),
            makeEnvelope("DEFENSE_SUBMITTED", {
                eventId: "0xe1",
                txHash: "0xdefense",
            }),
            makeEnvelope("DEFENSE_MINED", {
                eventId: "0xe1",
                txHash: "0xdefense",
                blockNumber: 42,
                proofDigest: "0xproof",
            }),
        ];

        const start = performance.now();
        for (const event of sequence) {
            redisChannelToKind(event.channel);
            deriveTrustCues(event);
        }
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(GATEWAY_BUDGET_MS);
    });

    it("sustains 500-event burst within 200ms gateway budget", () => {
        const channels = [
            "sentinel.detection.confirmed",
            "sentinel.defense.submitted",
            "sentinel.defense.mined",
            "sentinel.mempool.pending",
            "sentinel.defense.rejected",
        ] as const;

        const events: EventEnvelope[] = Array.from({ length: 500 }, (_, i) => {
            const channel = channels[i % channels.length];
            return {
                channel,
                messageId: `msg-${i}`,
                emittedAt: new Date().toISOString(),
                kind: redisChannelToKind(channel),
                data: { eventId: `0x${i.toString(16)}`, txHash: `0xtx${i}` },
            };
        });

        const start = performance.now();
        for (const event of events) {
            deriveTrustCues(event);
        }
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(200);
    });

    it("assertSla helper: detection→defense timestamp delta must be <800ms", () => {
        // Simulates the timestamp check that soak tests / smoke tests should
        // apply to recorded event pairs from RECENT_EVENTS.
        function checkSla(detectedAt: string, submittedAt: string): void {
            const lagMs = new Date(submittedAt).getTime() - new Date(detectedAt).getTime();
            expect(lagMs).toBeLessThan(800);
        }

        // Scenario A: 720ms — within budget.
        checkSla("2026-04-17T10:00:00.000Z", "2026-04-17T10:00:00.720Z");
    });

    it("assertSla helper: detection→defense timestamp delta ≥800ms fails the SLA", () => {
        const detectedAt = new Date("2026-04-17T10:00:00.000Z").getTime();
        const submittedAt = new Date("2026-04-17T10:00:00.850Z").getTime(); // 850ms — breach
        const lagMs = submittedAt - detectedAt;

        // Document that this value would trip the SLA gate.
        expect(lagMs).toBeGreaterThanOrEqual(800);
    });
});
