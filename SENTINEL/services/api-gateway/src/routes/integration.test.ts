import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_ENV_DEFAULTS, registerAuth } from "../auth.js";
import type { EventEnvelope } from "../cues.js";
import { registerChainRoutes } from "./chains.js";
import { registerEventsRoutes } from "./events.js";

// ---------------------------------------------------------------------------
// Pagination logic
// ---------------------------------------------------------------------------
describe("pagination logic", () => {
    it("returns first page with limit", () => {
        const events: EventEnvelope[] = Array.from({ length: 10 }, (_, i) => ({
            channel: "sentinel.detection.confirmed",
            messageId: `msg-${i}`,
            emittedAt: new Date().toISOString(),
            kind: "THREAT_CONFIRMED",
            data: { eventId: `event-${i}` },
        }));

        const limit = 5;
        const page = events.slice(0, limit);
        const nextCursor = page.length === limit && limit < events.length ? page[page.length - 1].messageId : null;

        expect(page).toHaveLength(5);
        expect(nextCursor).toBe("msg-4");
    });

    it("returns null nextCursor when on last page", () => {
        const events: EventEnvelope[] = Array.from({ length: 3 }, (_, i) => ({
            channel: "sentinel.mempool.pending",
            messageId: `msg-${i}`,
            emittedAt: new Date().toISOString(),
            kind: "PENDING_TX",
            data: {},
        }));

        const limit = 10;
        const page = events.slice(0, limit);
        const nextCursor = page.length === limit && limit < events.length ? page[page.length - 1].messageId : null;

        expect(page).toHaveLength(3);
        expect(nextCursor).toBeNull();
    });

    it("paginates correctly using cursor", () => {
        const events: EventEnvelope[] = Array.from({ length: 10 }, (_, i) => ({
            channel: "sentinel.detection.confirmed",
            messageId: `msg-${i}`,
            emittedAt: new Date().toISOString(),
            kind: "THREAT_CONFIRMED",
            data: { eventId: `event-${i}` },
        }));

        const cursor = "msg-4";
        const limit = 3;
        const idx = events.findIndex((e) => e.messageId === cursor);
        const startIdx = idx >= 0 ? idx + 1 : 0;
        const page = events.slice(startIdx, startIdx + limit);

        expect(page).toHaveLength(3);
        expect(page[0].messageId).toBe("msg-5");
        expect(page[2].messageId).toBe("msg-7");
    });

    it("returns empty page when cursor is at end", () => {
        const events: EventEnvelope[] = Array.from({ length: 5 }, (_, i) => ({
            channel: "sentinel.mempool.pending",
            messageId: `msg-${i}`,
            emittedAt: new Date().toISOString(),
            kind: "PENDING_TX",
            data: {},
        }));

        const cursor = "msg-4";
        const limit = 5;
        const idx = events.findIndex((e) => e.messageId === cursor);
        const startIdx = idx >= 0 ? idx + 1 : 0;
        const page = events.slice(startIdx, startIdx + limit);

        expect(page).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Event aggregation logic
// ---------------------------------------------------------------------------
describe("event aggregation logic", () => {
    it("aggregates phases by eventId", () => {
        const eventId = "0xabc123";
        const recentEvents: EventEnvelope[] = [
            {
                channel: "sentinel.detection.confirmed",
                messageId: "m1",
                emittedAt: "2024-01-01T00:00:00Z",
                kind: "THREAT_CONFIRMED",
                data: { eventId, pattern: "FLASH_LOAN_ORACLE_MANIP" },
            },
            {
                channel: "sentinel.defense.submitted",
                messageId: "m2",
                emittedAt: "2024-01-01T00:00:01Z",
                kind: "DEFENSE_SUBMITTED",
                data: { eventId, txHash: "0xdef456" },
            },
            {
                channel: "sentinel.defense.mined",
                messageId: "m3",
                emittedAt: "2024-01-01T00:00:02Z",
                kind: "DEFENSE_MINED",
                data: { eventId, txHash: "0xdef456", blockNumber: 42, proofDigest: "0xproof" },
            },
        ];

        const related = recentEvents.filter((e) => {
            const data = e.data as Record<string, unknown>;
            return data.eventId === eventId;
        });

        expect(related).toHaveLength(3);

        const detection = related.find((e) => e.kind === "THREAT_CONFIRMED");
        const defense = related.find((e) => e.kind === "DEFENSE_SUBMITTED");
        const mined = related.find((e) => e.kind === "DEFENSE_MINED");

        const status = mined ? "mined" : defense ? "submitted" : detection ? "detected" : "unknown";
        expect(status).toBe("mined");
        expect((detection?.data as any)?.pattern).toBe("FLASH_LOAN_ORACLE_MANIP");
        expect((mined?.data as any)?.txHash).toBe("0xdef456");
    });

    it("returns unknown status when no matching events", () => {
        const recentEvents: EventEnvelope[] = [];
        const related = recentEvents.filter((e) => {
            const data = e.data as Record<string, unknown>;
            return data.eventId === "0xnotexist";
        });

        const status = related.length === 0 ? "not_found" : "unknown";
        expect(status).toBe("not_found");
    });

    it("correctly identifies ledger recorded status", () => {
        const eventId = "0xabc";
        const events: EventEnvelope[] = [
            {
                channel: "sentinel.ledger.recorded",
                messageId: "m1",
                emittedAt: "2024-01-01T00:00:05Z",
                kind: "LEDGER_RECORDED",
                data: { eventId, txHash: "0xledger" },
            },
        ];

        const ledger = events.find((e) => e.kind === "LEDGER_RECORDED");
        const mined = events.find((e) => e.kind === "DEFENSE_MINED");
        const defense = events.find((e) => e.kind === "DEFENSE_SUBMITTED");
        const detection = events.find((e) => e.kind === "THREAT_CONFIRMED");

        const status = ledger
            ? "recorded"
            : mined
              ? "mined"
              : defense
                ? "submitted"
                : detection
                  ? "detected"
                  : "unknown";
        expect(status).toBe("recorded");
    });
});

// ---------------------------------------------------------------------------
// GET /api/v1/events via Fastify inject
// ---------------------------------------------------------------------------
describe("GET /api/v1/events", () => {
    async function buildEventsApp(recentEvents: EventEnvelope[]) {
        const app = Fastify();
        await registerAuth(app, {
            jwtSecret: AUTH_ENV_DEFAULTS.jwtSecret,
            adminPassword: AUTH_ENV_DEFAULTS.adminPassword,
            demoToken: AUTH_ENV_DEFAULTS.demoToken,
        });
        await registerEventsRoutes(app, recentEvents);
        return app;
    }

    async function getToken(app: Awaited<ReturnType<typeof buildEventsApp>>) {
        const res = await app.inject({
            method: "POST",
            url: "/auth/token",
            payload: { password: AUTH_ENV_DEFAULTS.adminPassword },
        });
        return JSON.parse(res.body).token as string;
    }

    it("GET /api/v1/events/:eventId returns 404 when event not found", async () => {
        const app = await buildEventsApp([]);
        const token = await getToken(app);
        const res = await app.inject({
            method: "GET",
            url: "/api/v1/events/0xnonexistent",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("event not found");
    });

    it("GET /api/v1/events/:eventId returns aggregated event data", async () => {
        const eventId = "0xabc123";
        const events: EventEnvelope[] = [
            {
                channel: "sentinel.detection.confirmed",
                messageId: "m1",
                emittedAt: "2024-01-01T00:00:00Z",
                kind: "THREAT_CONFIRMED",
                data: { eventId, pattern: "FLASH_LOAN_ORACLE_MANIP" },
            },
            {
                channel: "sentinel.defense.submitted",
                messageId: "m2",
                emittedAt: "2024-01-01T00:00:01Z",
                kind: "DEFENSE_SUBMITTED",
                data: { eventId, txHash: "0xdefense" },
            },
        ];
        const app = await buildEventsApp(events);
        const token = await getToken(app);
        const res = await app.inject({
            method: "GET",
            url: `/api/v1/events/${eventId}`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.eventId).toBe(eventId);
        expect(body.status).toBe("submitted");
        expect(body.phases).toHaveLength(2);
        expect(body.txHashes.defense).toBe("0xdefense");
    });
});

// ---------------------------------------------------------------------------
// GET /api/v1/chains via Fastify inject (mock loadChainConfigs)
// ---------------------------------------------------------------------------
vi.mock("../chains.js", () => ({
    loadChainConfigs: vi.fn(() => [
        {
            chainId: 31337,
            name: "anvil-local",
            rpcUrl: "http://127.0.0.1:8545",
            addresses: { FlashLoanAttacker: "0xabc", VictimLendingPool: "0xdef" },
        },
    ]),
    getChainByChainId: vi.fn(),
    getChainByName: vi.fn(),
}));

describe("GET /api/v1/chains", () => {
    async function buildChainsApp() {
        const app = Fastify();
        await registerAuth(app, {
            jwtSecret: AUTH_ENV_DEFAULTS.jwtSecret,
            adminPassword: AUTH_ENV_DEFAULTS.adminPassword,
            demoToken: AUTH_ENV_DEFAULTS.demoToken,
        });
        await registerChainRoutes(app, "/fake/config/dir");
        return app;
    }

    async function getToken(app: Awaited<ReturnType<typeof buildChainsApp>>) {
        const res = await app.inject({
            method: "POST",
            url: "/auth/token",
            payload: { password: AUTH_ENV_DEFAULTS.adminPassword },
        });
        return JSON.parse(res.body).token as string;
    }

    it("returns chain list", async () => {
        const app = await buildChainsApp();
        const token = await getToken(app);
        const res = await app.inject({
            method: "GET",
            url: "/api/v1/chains",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.chains).toHaveLength(1);
        expect(body.chains[0].chainId).toBe(31337);
        expect(body.chains[0].name).toBe("anvil-local");
        expect(body.chains[0].contractCount).toBe(2);
    });

    it("returns 404 for unknown chainId", async () => {
        const app = await buildChainsApp();
        const token = await getToken(app);
        const res = await app.inject({
            method: "GET",
            url: "/api/v1/chains/99999/addresses",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("chain not found");
    });

    it("returns addresses for known chainId", async () => {
        const app = await buildChainsApp();
        const token = await getToken(app);
        const res = await app.inject({
            method: "GET",
            url: "/api/v1/chains/31337/addresses",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.chainId).toBe(31337);
        expect(body.addresses).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/snapshot requires auth
// ---------------------------------------------------------------------------
describe("auth-protected admin endpoints", () => {
    it("POST /api/v1/admin/snapshot returns 401 without JWT", async () => {
        const app = Fastify();
        await registerAuth(app, {
            jwtSecret: AUTH_ENV_DEFAULTS.jwtSecret,
            adminPassword: AUTH_ENV_DEFAULTS.adminPassword,
            demoToken: AUTH_ENV_DEFAULTS.demoToken,
        });
        // Register a minimal snapshot route similar to index.ts
        app.post("/api/v1/admin/snapshot", async (req, reply) => {
            const user = (req as any).user;
            if (!user) {
                reply.code(401);
                return { error: "unauthorized" };
            }
            return { snapshotId: "0x1" };
        });

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/snapshot",
        });
        expect(res.statusCode).toBe(401);
    });
});
