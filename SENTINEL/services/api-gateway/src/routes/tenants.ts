import type { FastifyInstance } from "fastify";
import { getPool } from "../db.js";

export async function registerTenantRoutes(app: FastifyInstance): Promise<void> {
    const pool = getPool();

    // List all tenants (admin-only, no RLS — tenants table has no RLS)
    app.get("/api/v1/admin/tenants", async (req) => {
        const user = (req as any).user;
        if (!user || user.role !== "admin") {
            return { error: "admin role required" };
        }
        const { rows } = await pool.query(
            "SELECT id, name, slug, enabled, created_at FROM tenants ORDER BY created_at",
        );
        return { tenants: rows };
    });

    // Create a tenant
    app.post<{ Body: { name: string; slug: string } }>("/api/v1/admin/tenants", async (req, reply) => {
        const user = (req as any).user;
        if (!user || user.role !== "admin") {
            reply.code(403);
            return { error: "admin role required" };
        }
        const { name, slug } = req.body ?? {};
        if (!name || !slug) {
            reply.code(400);
            return { error: "name and slug required" };
        }
        // Validate slug format (lowercase alphanumeric + hyphens)
        if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length < 2) {
            reply.code(400);
            return { error: "slug must be lowercase alphanumeric with hyphens" };
        }
        try {
            const { rows } = await pool.query(
                "INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id, name, slug, enabled, created_at",
                [name, slug],
            );
            reply.code(201);
            return rows[0];
        } catch (err: any) {
            if (err.code === "23505") {
                // unique violation
                reply.code(409);
                return { error: "slug already exists" };
            }
            throw err;
        }
    });

    // Get a tenant by ID
    app.get<{ Params: { id: string } }>("/api/v1/admin/tenants/:id", async (req, reply) => {
        const user = (req as any).user;
        if (!user || user.role !== "admin") {
            reply.code(403);
            return { error: "admin role required" };
        }
        const { rows } = await pool.query("SELECT id, name, slug, enabled, created_at FROM tenants WHERE id = $1", [
            req.params.id,
        ]);
        if (rows.length === 0) {
            reply.code(404);
            return { error: "tenant not found" };
        }
        return rows[0];
    });

    // Update a tenant (enable/disable, rename)
    app.patch<{ Params: { id: string }; Body: { name?: string; enabled?: boolean } }>(
        "/api/v1/admin/tenants/:id",
        async (req, reply) => {
            const user = (req as any).user;
            if (!user || user.role !== "admin") {
                reply.code(403);
                return { error: "admin role required" };
            }
            const { name, enabled } = req.body ?? {};
            const sets: string[] = [];
            const vals: any[] = [];
            let idx = 1;
            if (name !== undefined) {
                sets.push(`name = $${idx++}`);
                vals.push(name);
            }
            if (enabled !== undefined) {
                sets.push(`enabled = $${idx++}`);
                vals.push(enabled);
            }
            if (sets.length === 0) {
                reply.code(400);
                return { error: "nothing to update" };
            }
            sets.push(`updated_at = now()`);
            vals.push(req.params.id);
            const { rows } = await pool.query(
                `UPDATE tenants SET ${sets.join(", ")} WHERE id = $${idx} RETURNING id, name, slug, enabled, created_at, updated_at`,
                vals,
            );
            if (rows.length === 0) {
                reply.code(404);
                return { error: "tenant not found" };
            }
            return rows[0];
        },
    );

    // Register protocol addresses for a tenant
    app.post<{ Params: { id: string }; Body: { address: string; label: string } }>(
        "/api/v1/admin/tenants/:id/addresses",
        async (req, reply) => {
            const user = (req as any).user;
            if (!user || user.role !== "admin") {
                reply.code(403);
                return { error: "admin role required" };
            }
            const { address, label } = req.body ?? {};
            if (!address || !label) {
                reply.code(400);
                return { error: "address and label required" };
            }
            try {
                const { rows } = await pool.query(
                    "INSERT INTO tenant_protocol_addresses (tenant_id, address, label) VALUES ($1, $2, $3) RETURNING id, tenant_id, address, label",
                    [req.params.id, address.toLowerCase(), label],
                );
                reply.code(201);
                return rows[0];
            } catch (err: any) {
                if (err.code === "23505") {
                    reply.code(409);
                    return { error: "address already registered for this tenant" };
                }
                if (err.code === "23503") {
                    // FK violation
                    reply.code(404);
                    return { error: "tenant not found" };
                }
                throw err;
            }
        },
    );

    // List addresses for a tenant
    app.get<{ Params: { id: string } }>("/api/v1/admin/tenants/:id/addresses", async (req, reply) => {
        const user = (req as any).user;
        if (!user || user.role !== "admin") {
            reply.code(403);
            return { error: "admin role required" };
        }
        const { rows } = await pool.query(
            "SELECT id, address, label, created_at FROM tenant_protocol_addresses WHERE tenant_id = $1",
            [req.params.id],
        );
        return { addresses: rows };
    });

    // Create a user for a tenant
    app.post<{ Params: { id: string }; Body: { email: string; role?: string } }>(
        "/api/v1/admin/tenants/:id/users",
        async (req, reply) => {
            const user = (req as any).user;
            if (!user || user.role !== "admin") {
                reply.code(403);
                return { error: "admin role required" };
            }
            const { email, role: userRole } = req.body ?? {};
            if (!email) {
                reply.code(400);
                return { error: "email required" };
            }
            const validRoles = ["admin", "operator", "viewer"];
            const assignedRole = userRole ?? "viewer";
            if (!validRoles.includes(assignedRole)) {
                reply.code(400);
                return { error: `role must be one of: ${validRoles.join(", ")}` };
            }
            try {
                const { rows } = await pool.query(
                    "INSERT INTO users (tenant_id, email, role) VALUES ($1, $2, $3) RETURNING id, tenant_id, email, role",
                    [req.params.id, email, assignedRole],
                );
                // Issue a JWT for the new user
                const newUser = rows[0];
                const token = app.jwt.sign({
                    sub: newUser.id,
                    tenant_id: req.params.id,
                    role: newUser.role,
                    email: newUser.email,
                });
                reply.code(201);
                return { user: newUser, token, expiresIn: 3600 };
            } catch (err: any) {
                if (err.code === "23505") {
                    reply.code(409);
                    return { error: "email already exists for this tenant" };
                }
                if (err.code === "23503") {
                    reply.code(404);
                    return { error: "tenant not found" };
                }
                throw err;
            }
        },
    );
}
