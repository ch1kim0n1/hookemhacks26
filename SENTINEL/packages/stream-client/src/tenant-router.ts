/**
 * Routes stream names through a tenant namespace.
 * Stream names become: {tenantSlug}.{originalStream}
 * e.g., "default.sentinel.mempool.pending"
 *
 * When tenantSlug is "default" or empty, uses the original stream name
 * for backward compatibility with single-tenant mode.
 */
export class TenantStreamRouter {
    private tenantSlug: string;

    constructor(tenantSlug: string) {
        this.tenantSlug = tenantSlug;
    }

    /** Resolve a logical stream name to a tenant-scoped physical stream name */
    resolve(stream: string): string {
        if (!this.tenantSlug || this.tenantSlug === "default") {
            return stream; // backward-compatible: default tenant uses bare stream names
        }
        return `${this.tenantSlug}.${stream}`;
    }

    /** Resolve a consumer group name to include tenant scope */
    resolveGroup(group: string): string {
        if (!this.tenantSlug || this.tenantSlug === "default") {
            return group;
        }
        return `${this.tenantSlug}-${group}`;
    }

    get slug(): string {
        return this.tenantSlug;
    }
}
