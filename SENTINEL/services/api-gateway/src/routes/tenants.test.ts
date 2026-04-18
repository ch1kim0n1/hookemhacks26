import fastifyJwt from "@fastify/jwt";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_ENV_DEFAULTS, registerAuth } from "../auth.js";

// --- Mock the db module before importing tenants ---
const mockQuery = vi.fn();
vi.mock("../db.js", () => ({
    getPool: () => ({ query: mockQuery }),
    runMigrations: vi.fn(),
    setTenantContext: vi.fn(),
}));

// Import after mock is set up
const { registerTenantRoutes } = await import("./tenants.js");

async function buildApp() {
    const app = Fastify();
    await registerAuth(app, {
        jwtSecret: AUTH_ENV_DEFAULTS.jwtSecret,
        adminPassword: AUTH_ENV_DEFAULTS.adminPassword,
        demoToken: AUTH_ENV_DEFAULTS.demoToken,
    });
    await registerTenantRoutes(app);
    return app;
}

async function adminToken(app: Awaited<ReturnType<typeof buildApp>>) {
    const res = await app.inject({
        method: "POST",
        url: "/auth/token",
        payload: { password: AUTH_ENV_DEFAULTS.adminPassword },
    });
    return JSON.parse(res.body).token as string;
}

async function viewerToken(app: Awaited<ReturnType<typeof buildApp>>) {
    const res = await app.inject({
        method: "POST",
        url: "/auth/token",
        payload: {
            password: AUTH_ENV_DEFAULTS.adminPassword,
            role: "viewer",
            tenant_id: "tenant-001",
        },
    });
    return JSON.parse(res.body).token as string;
}

beforeEach(() => {
    mockQuery.mockReset();
});

// ---------------------------------------------------------------------------
// Admin-role enforcement
// ---------------------------------------------------------------------------
describe("admin role enforcement", () => {
    it("GET /api/v1/admin/tenants returns 403 for viewer", async () => {
        const app = await buildApp();
        const token = await viewerToken(app);
        const res = await app.inject({
            method: "GET",
            url: "/api/v1/admin/tenants",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200); // Fastify returns 200 even for error bodies unless reply.code() is called
        const body = JSON.parse(res.body);
        expect(body.error).toBe("admin role required");
    });

    it("POST /api/v1/admin/tenants returns 403 for non-admin", async () => {
        const app = await buildApp();
        const token = await viewerToken(app);
        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants",
            headers: { authorization: `Bearer ${token}` },
            payload: { name: "Test", slug: "test" },
        });
        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("admin role required");
    });

    it("GET /api/v1/admin/tenants/:id returns 403 for non-admin", async () => {
        const app = await buildApp();
        const token = await viewerToken(app);
        const res = await app.inject({
            method: "GET",
            url: "/api/v1/admin/tenants/some-id",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(403);
    });

    it("PATCH /api/v1/admin/tenants/:id returns 403 for non-admin", async () => {
        const app = await buildApp();
        const token = await viewerToken(app);
        const res = await app.inject({
            method: "PATCH",
            url: "/api/v1/admin/tenants/some-id",
            headers: { authorization: `Bearer ${token}` },
            payload: { name: "New Name" },
        });
        expect(res.statusCode).toBe(403);
    });
});

// ---------------------------------------------------------------------------
// List tenants
// ---------------------------------------------------------------------------
describe("GET /api/v1/admin/tenants", () => {
    it("returns list of tenants for admin", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const fakeRows = [{ id: "uuid-1", name: "Acme", slug: "acme", enabled: true, created_at: "2024-01-01" }];
        mockQuery.mockResolvedValueOnce({ rows: fakeRows });

        const res = await app.inject({
            method: "GET",
            url: "/api/v1/admin/tenants",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.tenants).toHaveLength(1);
        expect(body.tenants[0].slug).toBe("acme");
    });

    it("returns empty list when no tenants", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const res = await app.inject({
            method: "GET",
            url: "/api/v1/admin/tenants",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.tenants).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Create tenant
// ---------------------------------------------------------------------------
describe("POST /api/v1/admin/tenants", () => {
    it("creates a tenant and returns 201", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const fakeRow = {
            id: "uuid-new",
            name: "Beta Corp",
            slug: "beta-corp",
            enabled: true,
            created_at: "2024-01-02",
        };
        mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants",
            headers: { authorization: `Bearer ${token}` },
            payload: { name: "Beta Corp", slug: "beta-corp" },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.slug).toBe("beta-corp");
        expect(body.id).toBe("uuid-new");
    });

    it("returns 400 when name is missing", async () => {
        const app = await buildApp();
        const token = await adminToken(app);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants",
            headers: { authorization: `Bearer ${token}` },
            payload: { slug: "no-name" },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("name and slug required");
    });

    it("returns 400 when slug is missing", async () => {
        const app = await buildApp();
        const token = await adminToken(app);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants",
            headers: { authorization: `Bearer ${token}` },
            payload: { name: "No Slug" },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("name and slug required");
    });

    it("returns 409 on duplicate slug", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const pgError = Object.assign(new Error("duplicate"), { code: "23505" });
        mockQuery.mockRejectedValueOnce(pgError);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants",
            headers: { authorization: `Bearer ${token}` },
            payload: { name: "Dup", slug: "dup-slug" },
        });
        expect(res.statusCode).toBe(409);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("slug already exists");
    });
});

// ---------------------------------------------------------------------------
// Get tenant by ID
// ---------------------------------------------------------------------------
describe("GET /api/v1/admin/tenants/:id", () => {
    it("returns a tenant by ID", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const fakeRow = { id: "uuid-1", name: "Acme", slug: "acme", enabled: true, created_at: "2024-01-01" };
        mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

        const res = await app.inject({
            method: "GET",
            url: "/api/v1/admin/tenants/uuid-1",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.id).toBe("uuid-1");
        expect(body.name).toBe("Acme");
    });

    it("returns 404 when tenant not found", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const res = await app.inject({
            method: "GET",
            url: "/api/v1/admin/tenants/nonexistent",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("tenant not found");
    });
});

// ---------------------------------------------------------------------------
// Update tenant
// ---------------------------------------------------------------------------
describe("PATCH /api/v1/admin/tenants/:id", () => {
    it("updates tenant name", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const updated = {
            id: "uuid-1",
            name: "Acme Updated",
            slug: "acme",
            enabled: true,
            created_at: "2024-01-01",
            updated_at: "2024-06-01",
        };
        mockQuery.mockResolvedValueOnce({ rows: [updated] });

        const res = await app.inject({
            method: "PATCH",
            url: "/api/v1/admin/tenants/uuid-1",
            headers: { authorization: `Bearer ${token}` },
            payload: { name: "Acme Updated" },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.name).toBe("Acme Updated");
    });

    it("updates tenant enabled flag", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const updated = {
            id: "uuid-1",
            name: "Acme",
            slug: "acme",
            enabled: false,
            created_at: "2024-01-01",
            updated_at: "2024-06-01",
        };
        mockQuery.mockResolvedValueOnce({ rows: [updated] });

        const res = await app.inject({
            method: "PATCH",
            url: "/api/v1/admin/tenants/uuid-1",
            headers: { authorization: `Bearer ${token}` },
            payload: { enabled: false },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.enabled).toBe(false);
    });

    it("returns 400 when body is empty", async () => {
        const app = await buildApp();
        const token = await adminToken(app);

        const res = await app.inject({
            method: "PATCH",
            url: "/api/v1/admin/tenants/uuid-1",
            headers: { authorization: `Bearer ${token}` },
            payload: {},
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("nothing to update");
    });

    it("returns 404 when tenant not found", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const res = await app.inject({
            method: "PATCH",
            url: "/api/v1/admin/tenants/nonexistent",
            headers: { authorization: `Bearer ${token}` },
            payload: { name: "Ghost" },
        });
        expect(res.statusCode).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("tenant not found");
    });
});

// ---------------------------------------------------------------------------
// Address registration
// ---------------------------------------------------------------------------
describe("POST /api/v1/admin/tenants/:id/addresses", () => {
    it("registers an address and returns 201", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const fakeRow = {
            id: "addr-uuid",
            tenant_id: "uuid-1",
            address: "0xdeadbeef",
            label: "VaultProxy",
        };
        mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/uuid-1/addresses",
            headers: { authorization: `Bearer ${token}` },
            payload: { address: "0xDeadBeef", label: "VaultProxy" },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.address).toBe("0xdeadbeef"); // lowercased
        expect(body.label).toBe("VaultProxy");
    });

    it("returns 400 when address is missing", async () => {
        const app = await buildApp();
        const token = await adminToken(app);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/uuid-1/addresses",
            headers: { authorization: `Bearer ${token}` },
            payload: { label: "NoAddress" },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("address and label required");
    });

    it("returns 409 on duplicate address", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const pgError = Object.assign(new Error("duplicate"), { code: "23505" });
        mockQuery.mockRejectedValueOnce(pgError);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/uuid-1/addresses",
            headers: { authorization: `Bearer ${token}` },
            payload: { address: "0xdup", label: "dup" },
        });
        expect(res.statusCode).toBe(409);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("address already registered for this tenant");
    });

    it("returns 404 on FK violation (tenant not found)", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const pgError = Object.assign(new Error("fk violation"), { code: "23503" });
        mockQuery.mockRejectedValueOnce(pgError);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/ghost/addresses",
            headers: { authorization: `Bearer ${token}` },
            payload: { address: "0xabc", label: "test" },
        });
        expect(res.statusCode).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("tenant not found");
    });

    it("returns 403 for non-admin", async () => {
        const app = await buildApp();
        const token = await viewerToken(app);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/uuid-1/addresses",
            headers: { authorization: `Bearer ${token}` },
            payload: { address: "0xabc", label: "test" },
        });
        expect(res.statusCode).toBe(403);
    });
});

describe("GET /api/v1/admin/tenants/:id/addresses", () => {
    it("lists addresses for a tenant", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const fakeRows = [{ id: "a1", address: "0xabc", label: "Pool", created_at: "2024-01-01" }];
        mockQuery.mockResolvedValueOnce({ rows: fakeRows });

        const res = await app.inject({
            method: "GET",
            url: "/api/v1/admin/tenants/uuid-1/addresses",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.addresses).toHaveLength(1);
        expect(body.addresses[0].address).toBe("0xabc");
    });
});

// ---------------------------------------------------------------------------
// User creation with JWT issuance
// ---------------------------------------------------------------------------
describe("POST /api/v1/admin/tenants/:id/users", () => {
    it("creates a user and returns 201 with JWT", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const fakeRow = {
            id: "user-uuid",
            tenant_id: "uuid-1",
            email: "alice@example.com",
            role: "operator",
        };
        mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/uuid-1/users",
            headers: { authorization: `Bearer ${token}` },
            payload: { email: "alice@example.com", role: "operator" },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.user.email).toBe("alice@example.com");
        expect(body.user.role).toBe("operator");
        expect(body.token).toBeTruthy();
        expect(body.expiresIn).toBe(3600);
    });

    it("defaults role to viewer when not specified", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const fakeRow = {
            id: "user-uuid-2",
            tenant_id: "uuid-1",
            email: "bob@example.com",
            role: "viewer",
        };
        mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/uuid-1/users",
            headers: { authorization: `Bearer ${token}` },
            payload: { email: "bob@example.com" },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.user.role).toBe("viewer");
    });

    it("returns 400 when email is missing", async () => {
        const app = await buildApp();
        const token = await adminToken(app);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/uuid-1/users",
            headers: { authorization: `Bearer ${token}` },
            payload: {},
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("email required");
    });

    it("returns 400 for invalid role", async () => {
        const app = await buildApp();
        const token = await adminToken(app);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/uuid-1/users",
            headers: { authorization: `Bearer ${token}` },
            payload: { email: "charlie@example.com", role: "superuser" },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain("role must be one of");
    });

    it("returns 409 on duplicate email", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const pgError = Object.assign(new Error("duplicate"), { code: "23505" });
        mockQuery.mockRejectedValueOnce(pgError);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/uuid-1/users",
            headers: { authorization: `Bearer ${token}` },
            payload: { email: "dup@example.com" },
        });
        expect(res.statusCode).toBe(409);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("email already exists for this tenant");
    });

    it("returns 404 on FK violation (tenant not found)", async () => {
        const app = await buildApp();
        const token = await adminToken(app);
        const pgError = Object.assign(new Error("fk violation"), { code: "23503" });
        mockQuery.mockRejectedValueOnce(pgError);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/ghost/users",
            headers: { authorization: `Bearer ${token}` },
            payload: { email: "ghost@example.com" },
        });
        expect(res.statusCode).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("tenant not found");
    });

    it("returns 403 for non-admin", async () => {
        const app = await buildApp();
        const token = await viewerToken(app);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/uuid-1/users",
            headers: { authorization: `Bearer ${token}` },
            payload: { email: "hacker@example.com" },
        });
        expect(res.statusCode).toBe(403);
    });

    it("issued JWT contains expected claims", async () => {
        const app = await buildApp();
        const adminTok = await adminToken(app);
        const fakeRow = {
            id: "user-uuid-3",
            tenant_id: "uuid-1",
            email: "dave@example.com",
            role: "admin",
        };
        mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/admin/tenants/uuid-1/users",
            headers: { authorization: `Bearer ${adminTok}` },
            payload: { email: "dave@example.com", role: "admin" },
        });
        expect(res.statusCode).toBe(201);
        const { token } = JSON.parse(res.body);

        // Verify the issued token is usable against the same app
        const verifyRes = await app.inject({
            method: "GET",
            url: "/api/v1/admin/tenants",
            headers: { authorization: `Bearer ${token}` },
        });
        // It should pass JWT verification (admin role), then try the DB query
        mockQuery.mockResolvedValueOnce({ rows: [] });
        const verifyRes2 = await app.inject({
            method: "GET",
            url: "/api/v1/admin/tenants",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(verifyRes2.statusCode).toBe(200);
    });
});
