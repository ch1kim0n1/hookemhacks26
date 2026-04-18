import { describe, expect, it } from "vitest";
import { WS_RECONNECT_MAX_ATTEMPTS } from "./ws-config.js";

describe("ws-config", () => {
    it("documents max WS reconnect attempts for Issue #38 / ops visibility", () => {
        expect(WS_RECONNECT_MAX_ATTEMPTS).toBe(5);
    });
});
