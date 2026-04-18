import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyRequest } from "./audit.js"; // You'll need to export classifyRequest for testing

// Test the classify function
describe("audit classifyRequest", () => {
    it("classifies tenant creation", () => {
        const result = classifyRequest("POST", "/api/v1/admin/tenants");
        expect(result).toEqual({ action: "create", resourceType: "tenant" });
    });

    it("classifies tenant update", () => {
        const result = classifyRequest("PATCH", "/api/v1/admin/tenants/abc-123");
        expect(result).toEqual({ action: "update", resourceType: "tenant", resourceId: "abc-123" });
    });

    it("classifies address creation", () => {
        const result = classifyRequest("POST", "/api/v1/admin/tenants/abc-123/addresses");
        expect(result).toEqual({ action: "create", resourceType: "address", resourceId: "abc-123" });
    });

    it("classifies user creation", () => {
        const result = classifyRequest("POST", "/api/v1/admin/tenants/abc-123/users");
        expect(result).toEqual({ action: "create", resourceType: "user", resourceId: "abc-123" });
    });

    it("classifies scenario replay", () => {
        const result = classifyRequest("POST", "/api/v1/demo/replay-scenario");
        expect(result).toEqual({ action: "execute", resourceType: "scenario", resourceId: "scenario-a" });
    });

    it("classifies snapshot", () => {
        const result = classifyRequest("POST", "/api/v1/admin/snapshot");
        expect(result).toEqual({ action: "execute", resourceType: "snapshot" });
    });

    it("classifies auth token request", () => {
        const result = classifyRequest("POST", "/auth/token");
        expect(result).toEqual({ action: "execute", resourceType: "auth" });
    });
});
