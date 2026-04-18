import type { FastifyReply, FastifyRequest } from "fastify";

export type Role = "admin" | "operator" | "viewer";

/** Permission definitions per route pattern + method */
interface RoutePermission {
    pattern: RegExp;
    methods: string[];
    minRole: Role;
}

const ROLE_HIERARCHY: Record<Role, number> = {
    admin: 3,
    operator: 2,
    viewer: 1,
};

const ROUTE_PERMISSIONS: RoutePermission[] = [
    // Operator routes (must come before the admin catch-all)
    { pattern: /^\/api\/v1\/demo\//, methods: ["POST"], minRole: "operator" },
    { pattern: /^\/api\/v1\/admin\/snapshot$/, methods: ["POST"], minRole: "operator" },

    // Admin-only routes
    { pattern: /^\/api\/v1\/admin\//, methods: ["GET", "POST", "PATCH", "DELETE"], minRole: "admin" },

    // Viewer routes (read-only)
    { pattern: /^\/api\/v1\//, methods: ["GET"], minRole: "viewer" },
];

export function hasPermission(role: Role, minRole: Role): boolean {
    return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minRole];
}

/**
 * Find the minimum required role for a given route + method.
 * Returns undefined if no permission rule matches (route is unprotected or handled elsewhere).
 */
export function getRequiredRole(method: string, url: string): Role | undefined {
    // Strip query string
    const path = url.split("?")[0];
    for (const perm of ROUTE_PERMISSIONS) {
        if (perm.pattern.test(path) && perm.methods.includes(method.toUpperCase())) {
            return perm.minRole;
        }
    }
    return undefined;
}

/**
 * Fastify hook that checks RBAC after auth.
 * Assumes auth middleware has already set req.user with { role, tenant_id }.
 * Only applies to authenticated requests (req.user must exist).
 */
export async function rbacHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = (req as any).user;
    if (!user) return; // No user = auth middleware handles it (public/demo routes)

    const requiredRole = getRequiredRole(req.method, req.url);
    if (!requiredRole) return; // No RBAC rule for this route

    if (!hasPermission(user.role as Role, requiredRole)) {
        reply.code(403).send({
            error: "forbidden",
            message: `Role '${user.role}' lacks permission. Required: '${requiredRole}'`,
        });
    }
}
