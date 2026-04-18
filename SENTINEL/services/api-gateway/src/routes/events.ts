import type { FastifyInstance } from "fastify";
import type { EventEnvelope } from "../cues.js";

export async function registerEventsRoutes(app: FastifyInstance, recentEvents: EventEnvelope[]): Promise<void> {
    app.get<{ Params: { eventId: string } }>("/api/v1/events/:eventId", async (req, reply) => {
        const { eventId } = req.params;
        // Find all envelopes related to this eventId
        const related = recentEvents.filter((e) => {
            const data = e.data as Record<string, unknown>;
            return data.eventId === eventId;
        });

        if (related.length === 0) {
            reply.code(404);
            return { error: "event not found" };
        }

        // Aggregate into phases
        const phases = related.map((e) => ({
            kind: e.kind,
            channel: e.channel,
            timestamp: e.emittedAt,
            data: e.data,
        }));

        // Extract specific fields
        const detection = related.find((e) => e.kind === "THREAT_CONFIRMED");
        const defense = related.find((e) => e.kind === "DEFENSE_SUBMITTED");
        const mined = related.find((e) => e.kind === "DEFENSE_MINED");
        const counterfactual = related.find((e) => e.kind === "COUNTERFACTUAL_READY");
        const ledger = related.find((e) => e.kind === "LEDGER_RECORDED");

        return {
            eventId,
            status: ledger ? "recorded" : mined ? "mined" : defense ? "submitted" : detection ? "detected" : "unknown",
            phases,
            txHashes: {
                defense: (defense?.data as any)?.txHash ?? null,
                mined: (mined?.data as any)?.txHash ?? null,
                ledger: (ledger?.data as any)?.txHash ?? null,
            },
            proofs: {
                policyDigest: (mined?.data as any)?.proofDigest ?? null,
                counterfactualRoot: (counterfactual?.data as any)?.counterfactualRoot ?? null,
            },
            timeline: {
                detected: detection?.emittedAt ?? null,
                defended: defense?.emittedAt ?? null,
                mined: mined?.emittedAt ?? null,
                recorded: ledger?.emittedAt ?? null,
            },
        };
    });
}
