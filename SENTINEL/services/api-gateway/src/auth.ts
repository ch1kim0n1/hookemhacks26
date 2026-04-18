import { readFileSync } from "node:fs";
import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export const AUTH_ENV_DEFAULTS = {
    jwtSecret: "sentinel-dev-secret-change-me",
    adminPassword: "sentinel-admin",
    demoToken: "sentinel-demo",
};

export interface AuthConfig {
    // HS256 fallback
    jwtSecret?: string;
    // RS256 (preferred)
    privateKeyPath?: string;
    publicKeyPath?: string;
    previousPublicKeyPath?: string; // for rotation overlap
    // Shared
    adminPassword: string;
    demoToken: string;
}

const PUBLIC_ROUTES = new Set(["/api/v1/health", "/auth/token", "/.well-known/jwks.json"]);

function isDemoRoute(url: string): boolean {
    return url.startsWith("/api/v1/demo/") || url === "/ws";
}

export async function registerAuth(app: FastifyInstance, config: AuthConfig): Promise<void> {
    // Determine signing method
    let jwtOpts: any;
    if (config.privateKeyPath) {
        const privateKey = readFileSync(config.privateKeyPath, "utf-8");
        const publicKey = readFileSync(config.publicKeyPath!, "utf-8");
        jwtOpts = {
            secret: {
                private: privateKey,
                public: publicKey,
            },
            sign: { algorithm: "RS256", expiresIn: 3600 },
            verify: { algorithms: ["RS256"] },
        };
    } else {
        jwtOpts = {
            secret: config.jwtSecret ?? AUTH_ENV_DEFAULTS.jwtSecret,
        };
    }
    await app.register(fastifyJwt, jwtOpts);

    // JWKS endpoint for public key distribution
    if (config.publicKeyPath) {
        const publicKeyPem = readFileSync(config.publicKeyPath, "utf-8");
        app.get("/.well-known/jwks.json", async () => {
            // Convert PEM to JWK format
            const crypto = await import("node:crypto");
            const keyObject = crypto.createPublicKey(publicKeyPem);
            const jwk = keyObject.export({ format: "jwk" });
            return {
                keys: [{ ...jwk, kid: "sentinel-primary", use: "sig", alg: "RS256" }],
            };
        });
    }

    app.post<{ Body: { password: string; tenant_id?: string; role?: string } }>("/auth/token", async (req, reply) => {
        const { password, tenant_id, role } = req.body ?? {};
        if (password !== config.adminPassword) {
            reply.code(401);
            return { error: "invalid password" };
        }
        const token = app.jwt.sign({
            sub: "admin",
            tenant_id: tenant_id ?? "00000000-0000-0000-0000-000000000001",
            role: role ?? "admin",
        });
        return { token, expiresIn: 3600 };
    });

    app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
        const url = req.url.split("?")[0];
        if (PUBLIC_ROUTES.has(url)) return;
        if (isDemoRoute(url)) {
            const demoToken = req.headers["x-demo-token"] as string | undefined;
            if (demoToken === config.demoToken) return;
        }
        try {
            const decoded = await req.jwtVerify();
            (req as any).user = decoded;
        } catch {
            reply.code(401).send({ error: "unauthorized" });
        }
    });
}
