import type { FastifyInstance } from "fastify";
import type { StreamPublisher } from "@sentinel/stream-client";
import type { ApprovalRecord } from "./evidence.js";

/**
 * Human approval gate endpoints.
 *
 * When `defense-agent` runs with `SENTINEL_REQUIRE_APPROVAL=1`, it
 * pauses defense submission on high-confidence threats and publishes
 * `sentinel.defense.pending_approval`. An operator then calls
 * `/api/v1/approvals/:eventId/approve` (or `/reject`), which publishes
 * a decision to `sentinel.defense.approval`. The agent consumes that
 * stream and either submits the defense tx or abandons the flow.
 *
 * The decision is kept in `approvalRecords` so the evidence bundle
 * endpoint (`/api/v1/evidence/:eventId/export`) can surface who
 * authorised a released defense — "the agent is on a crypto leash AND
 * a human was in the loop" is only a real claim if we can show both.
 */
export async function registerApprovalRoutes(
    app: FastifyInstance,
    streamPub: StreamPublisher,
    approvalRecords: Map<string, ApprovalRecord>,
): Promise<void> {
    app.post<{
        Params: { eventId: string };
        Body: { approver?: string; note?: string };
    }>("/api/v1/approvals/:eventId/approve", async (req, reply) => {
        const { eventId } = req.params;
        if (!/^0x[0-9a-fA-F]{64}$/.test(eventId)) {
            reply.code(400);
            return {
                error: { code: "BAD_EVENT_ID", message: "eventId must be 0x + 64 hex chars" },
            };
        }
        const approver =
            (req.body?.approver as string | undefined) ??
            (req as { user?: { sub?: string } }).user?.sub ??
            "operator";
        const record: ApprovalRecord = {
            approver,
            decidedAt: new Date().toISOString(),
            decision: "approve",
            note: req.body?.note,
        };
        approvalRecords.set(eventId, record);
        await streamPub.publish("sentinel.defense.approval", {
            schema: "DefenseApprovalEvent@1",
            eventId,
            decision: "approve",
            approver: record.approver,
            decidedAt: record.decidedAt,
            note: record.note ?? null,
        });
        return { eventId, ...record };
    });

    app.post<{
        Params: { eventId: string };
        Body: { approver?: string; note?: string };
    }>("/api/v1/approvals/:eventId/reject", async (req, reply) => {
        const { eventId } = req.params;
        if (!/^0x[0-9a-fA-F]{64}$/.test(eventId)) {
            reply.code(400);
            return {
                error: { code: "BAD_EVENT_ID", message: "eventId must be 0x + 64 hex chars" },
            };
        }
        const approver =
            (req.body?.approver as string | undefined) ??
            (req as { user?: { sub?: string } }).user?.sub ??
            "operator";
        const record: ApprovalRecord = {
            approver,
            decidedAt: new Date().toISOString(),
            decision: "reject",
            note: req.body?.note,
        };
        approvalRecords.set(eventId, record);
        await streamPub.publish("sentinel.defense.approval", {
            schema: "DefenseApprovalEvent@1",
            eventId,
            decision: "reject",
            approver: record.approver,
            decidedAt: record.decidedAt,
            note: record.note ?? null,
        });
        return { eventId, ...record };
    });

    app.get("/api/v1/approvals", async () => {
        const entries = Array.from(approvalRecords.entries()).map(([eventId, record]) => ({
            eventId,
            ...record,
        }));
        return { approvals: entries };
    });
}
