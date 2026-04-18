/**
 * Tests for the flaky-WiFi hardening in SentinelSocket.
 *
 * These run under jsdom (default for vitest) — the global WebSocket
 * constructor is monkey-patched so we can drive open/close/message
 * frames deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SentinelSocket, type WsStatus } from "./ws";

type FakeSocket = {
    url: string;
    readyState: number;
    listeners: Record<string, Array<(ev: unknown) => void>>;
    addEventListener: (ev: string, cb: (ev: unknown) => void) => void;
    send: (s: string) => void;
    close: () => void;
    // Test hooks:
    _fireOpen: () => void;
    _fireClose: () => void;
    _fireMessage: (data: unknown) => void;
};

let instances: FakeSocket[] = [];

function installFakeWebSocket(): void {
    class FakeWS {
        url: string;
        readyState = 0;
        listeners: Record<string, Array<(ev: unknown) => void>> = {};
        sent: string[] = [];
        constructor(url: string) {
            this.url = url;
            const self = this as unknown as FakeSocket;
            self.addEventListener = (ev, cb) => {
                (self.listeners[ev] ||= []).push(cb);
            };
            self.send = (s: string) => {
                this.sent.push(s);
            };
            self.close = () => {
                this.readyState = 3;
                self._fireClose();
            };
            self._fireOpen = () => {
                this.readyState = 1;
                self.listeners.open?.forEach((cb) => cb({} as unknown));
            };
            self._fireClose = () => {
                // Matches browser semantics: readyState flips to CLOSED
                // *before* the close event fires.
                this.readyState = 3;
                self.listeners.close?.forEach((cb) => cb({} as unknown));
            };
            self._fireMessage = (data: unknown) => {
                self.listeners.message?.forEach((cb) => cb({ data: JSON.stringify(data) } as unknown));
            };
            instances.push(self);
        }
    }
    // @ts-expect-error override browser global
    globalThis.WebSocket = FakeWS;
    // @ts-expect-error attach ready-state constants used by code under test
    globalThis.WebSocket.OPEN = 1;
    // @ts-expect-error
    globalThis.WebSocket.CONNECTING = 0;
}

beforeEach(() => {
    instances = [];
    installFakeWebSocket();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("SentinelSocket", () => {
    it("emits `degraded` after degradedAfterMs of continuous disconnect", () => {
        const seen: WsStatus[] = [];
        const sock = new SentinelSocket({ degradedAfterMs: 500 });
        sock.onStatus((s) => seen.push(s));
        sock.connect();

        // Socket opens, then closes — backoff kicks in but stays closed.
        instances[0]._fireOpen();
        instances[0]._fireClose();

        vi.advanceTimersByTime(600);

        expect(seen).toContain("degraded");
    });

    it("clears `degraded` and returns to `open` on reconnect", () => {
        const seen: WsStatus[] = [];
        const sock = new SentinelSocket({ degradedAfterMs: 100, backoffCapMs: 50 });
        sock.onStatus((s) => seen.push(s));
        sock.connect();

        instances[0]._fireOpen();
        instances[0]._fireClose();

        vi.advanceTimersByTime(200);
        expect(seen).toContain("degraded");

        // Run the reconnect timer; second instance opens successfully.
        vi.advanceTimersByTime(100);
        expect(instances.length).toBeGreaterThan(1);
        instances[instances.length - 1]._fireOpen();

        expect(seen[seen.length - 1]).toBe("open");
    });

    it("closes a stale socket when no frame arrives within staleTimeoutMs", () => {
        const sock = new SentinelSocket({ staleTimeoutMs: 300, degradedAfterMs: 99999 });
        sock.connect();
        instances[0]._fireOpen();

        // No messages; watchdog should force close.
        vi.advanceTimersByTime(400);

        expect(instances[0].readyState).toBe(3);
    });

    it("keeps stale-watchdog happy as long as frames arrive", () => {
        const sock = new SentinelSocket({ staleTimeoutMs: 300, heartbeatMs: 9999 });
        sock.connect();
        instances[0]._fireOpen();

        for (let i = 0; i < 5; i++) {
            vi.advanceTimersByTime(200);
            instances[0]._fireMessage({ op: "pong", ts: Date.now() });
        }

        expect(instances[0].readyState).toBe(1);
    });

    it("does not schedule reconnect after close() is called", () => {
        const sock = new SentinelSocket({ backoffCapMs: 10 });
        sock.connect();
        instances[0]._fireOpen();
        sock.close();

        vi.advanceTimersByTime(200);
        // Only the original instance — close() prevents reconnects.
        expect(instances.length).toBe(1);
    });
});
