import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { AUTH_ENV_DEFAULTS, registerAuth } from "./auth.js";

async function buildApp(envOverrides?: Record<string, string>) {
    const app = Fastify();
    await registerAuth(app, {
        jwtSecret: envOverrides?.SENTINEL_JWT_SECRET ?? AUTH_ENV_DEFAULTS.jwtSecret,
        adminPassword: envOverrides?.SENTINEL_ADMIN_PASSWORD ?? AUTH_ENV_DEFAULTS.adminPassword,
        demoToken: envOverrides?.SENTINEL_DEMO_TOKEN ?? AUTH_ENV_DEFAULTS.demoToken,
    });
    // Protected test route
    app.get("/api/v1/ledger", async (req) => {
        return { user: (req as any).user, ok: true };
    });
    // Demo-gated test route
    app.post("/api/v1/demo/replay-scenario", async () => ({ replayed: true }));
    // Public route
    app.get("/api/v1/health", async () => ({ status: "ok" }));
    return app;
}

describe("auth middleware", () => {
    it("allows public routes without auth", async () => {
        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: "/api/v1/health" });
        expect(res.statusCode).toBe(200);
    });

    it("rejects protected routes without token", async () => {
        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: "/api/v1/ledger" });
        expect(res.statusCode).toBe(401);
    });

    it("mints a token via /auth/token", async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: "POST",
            url: "/auth/token",
            payload: { password: "sentinel-admin" },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.token).toBeTruthy();
        expect(body.expiresIn).toBe(3600);
    });

    it("rejects /auth/token with wrong password", async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: "POST",
            url: "/auth/token",
            payload: { password: "wrong" },
        });
        expect(res.statusCode).toBe(401);
    });

    it("allows protected routes with valid JWT", async () => {
        const app = await buildApp();
        const tokenRes = await app.inject({
            method: "POST",
            url: "/auth/token",
            payload: { password: "sentinel-admin" },
        });
        const { token } = JSON.parse(tokenRes.body);
        const res = await app.inject({
            method: "GET",
            url: "/api/v1/ledger",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.user.sub).toBe("admin");
        expect(body.user.tenant_id).toBe("00000000-0000-0000-0000-000000000001");
    });

    it("allows demo routes with x-demo-token", async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: "POST",
            url: "/api/v1/demo/replay-scenario",
            headers: { "x-demo-token": "sentinel-demo" },
        });
        expect(res.statusCode).toBe(200);
    });

    it("rejects demo routes without any auth", async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: "POST",
            url: "/api/v1/demo/replay-scenario",
        });
        expect(res.statusCode).toBe(401);
    });
});

describe("auth middleware (RS256)", () => {
    let keyDir: string;
    let privateKeyPath: string;
    let publicKeyPath: string;

    beforeAll(() => {
        keyDir = mkdtempSync(join(tmpdir(), "jwt-test-"));
        const { privateKey, publicKey } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
        });
        privateKeyPath = join(keyDir, "private.pem");
        publicKeyPath = join(keyDir, "public.pem");
        writeFileSync(privateKeyPath, privateKey);
        writeFileSync(publicKeyPath, publicKey);
    });

    async function buildRs256App() {
        const app = Fastify();
        await registerAuth(app, {
            privateKeyPath,
            publicKeyPath,
            adminPassword: AUTH_ENV_DEFAULTS.adminPassword,
            demoToken: AUTH_ENV_DEFAULTS.demoToken,
        });
        app.get("/api/v1/ledger", async (req) => {
            return { user: (req as any).user, ok: true };
        });
        app.post("/api/v1/demo/replay-scenario", async () => ({ replayed: true }));
        app.get("/api/v1/health", async () => ({ status: "ok" }));
        return app;
    }

    it("allows public routes without auth", async () => {
        const app = await buildRs256App();
        const res = await app.inject({ method: "GET", url: "/api/v1/health" });
        expect(res.statusCode).toBe(200);
    });

    it("rejects protected routes without token", async () => {
        const app = await buildRs256App();
        const res = await app.inject({ method: "GET", url: "/api/v1/ledger" });
        expect(res.statusCode).toBe(401);
    });

    it("mints a token via /auth/token", async () => {
        const app = await buildRs256App();
        const res = await app.inject({
            method: "POST",
            url: "/auth/token",
            payload: { password: "sentinel-admin" },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.token).toBeTruthy();
        expect(body.expiresIn).toBe(3600);
    });

    it("rejects /auth/token with wrong password", async () => {
        const app = await buildRs256App();
        const res = await app.inject({
            method: "POST",
            url: "/auth/token",
            payload: { password: "wrong" },
        });
        expect(res.statusCode).toBe(401);
    });

    it("allows protected routes with valid RS256 JWT", async () => {
        const app = await buildRs256App();
        const tokenRes = await app.inject({
            method: "POST",
            url: "/auth/token",
            payload: { password: "sentinel-admin" },
        });
        const { token } = JSON.parse(tokenRes.body);
        const res = await app.inject({
            method: "GET",
            url: "/api/v1/ledger",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.user.sub).toBe("admin");
        expect(body.user.tenant_id).toBe("00000000-0000-0000-0000-000000000001");
        expect(body.user.role).toBe("admin");
    });

    it("exposes JWKS endpoint", async () => {
        const app = await buildRs256App();
        const res = await app.inject({ method: "GET", url: "/.well-known/jwks.json" });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.keys).toHaveLength(1);
        expect(body.keys[0].kid).toBe("sentinel-primary");
        expect(body.keys[0].alg).toBe("RS256");
        expect(body.keys[0].use).toBe("sig");
        expect(body.keys[0].kty).toBe("RSA");
    });

    it("allows demo routes with x-demo-token", async () => {
        const app = await buildRs256App();
        const res = await app.inject({
            method: "POST",
            url: "/api/v1/demo/replay-scenario",
            headers: { "x-demo-token": "sentinel-demo" },
        });
        expect(res.statusCode).toBe(200);
    });

    it("rejects demo routes without any auth", async () => {
        const app = await buildRs256App();
        const res = await app.inject({
            method: "POST",
            url: "/api/v1/demo/replay-scenario",
        });
        expect(res.statusCode).toBe(401);
    });

    it("mints token with custom tenant_id and role", async () => {
        const app = await buildRs256App();
        const tokenRes = await app.inject({
            method: "POST",
            url: "/auth/token",
            payload: { password: "sentinel-admin", tenant_id: "tenant-abc", role: "viewer" },
        });
        const { token } = JSON.parse(tokenRes.body);
        const res = await app.inject({
            method: "GET",
            url: "/api/v1/ledger",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.user.tenant_id).toBe("tenant-abc");
        expect(body.user.role).toBe("viewer");
    });
});
