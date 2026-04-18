import { describe, expect, it } from "vitest";
import { getRequiredRole, hasPermission } from "./rbac.js";

describe("RBAC", () => {
    describe("hasPermission", () => {
        it("admin has all permissions", () => {
            expect(hasPermission("admin", "admin")).toBe(true);
            expect(hasPermission("admin", "operator")).toBe(true);
            expect(hasPermission("admin", "viewer")).toBe(true);
        });

        it("operator has operator and viewer permissions", () => {
            expect(hasPermission("operator", "admin")).toBe(false);
            expect(hasPermission("operator", "operator")).toBe(true);
            expect(hasPermission("operator", "viewer")).toBe(true);
        });

        it("viewer only has viewer permissions", () => {
            expect(hasPermission("viewer", "admin")).toBe(false);
            expect(hasPermission("viewer", "operator")).toBe(false);
            expect(hasPermission("viewer", "viewer")).toBe(true);
        });
    });

    describe("getRequiredRole", () => {
        it("admin routes require admin", () => {
            expect(getRequiredRole("GET", "/api/v1/admin/tenants")).toBe("admin");
            expect(getRequiredRole("POST", "/api/v1/admin/tenants")).toBe("admin");
        });

        it("demo POST routes require operator", () => {
            expect(getRequiredRole("POST", "/api/v1/demo/replay-scenario")).toBe("operator");
        });

        it("snapshot requires operator", () => {
            expect(getRequiredRole("POST", "/api/v1/admin/snapshot")).toBe("operator");
        });

        it("GET API routes require viewer", () => {
            expect(getRequiredRole("GET", "/api/v1/ledger")).toBe("viewer");
            expect(getRequiredRole("GET", "/api/v1/events")).toBe("viewer");
        });

        it("returns undefined for unmatched routes", () => {
            expect(getRequiredRole("GET", "/health")).toBeUndefined();
            expect(getRequiredRole("GET", "/.well-known/jwks.json")).toBeUndefined();
        });
    });
});
