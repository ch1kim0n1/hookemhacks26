/**
 * WebSocket event source for the SENTINEL api-gateway firehose.
 *
 * Wraps /ws with auto-reconnect, hello handshake, multi-channel
 * subscription, and flaky-WiFi hardening:
 *   - Exponential backoff with full jitter (Cap + Jitter) to avoid
 *     thundering-herd reconnects.
 *   - Heartbeat ping + liveness watchdog — a socket that has gone
 *     quiet for `staleTimeoutMs` is force-closed so reconnect fires.
 *   - "degraded" status after `degradedAfterMs` of continuous
 *     disconnection, so the UI can swap to a fallback feed (local
 *     simulator, cached snapshot) instead of sitting on a stale
 *     spinner during a hackathon demo on conference WiFi.
 *   - `online`/`offline` browser events pause/resume reconnection —
 *     no point burning battery retrying when the NIC is down.
 */
import { wsUrl } from "./api";

export interface EventEnvelope {
    channel: string;
    messageId: string;
    emittedAt: string;
    kind: string;
    data: Record<string, unknown>;
}

export type SentinelEvent =
    | { op: "event"; channel: string; data: EventEnvelope }
    | { op: "welcome"; serverTime: string; version?: string; subscriptionsAvailable?: string[] }
    | { op: "subscribed"; channel: string }
    | { op: "unsubscribed"; channel: string }
    | { op: "pong"; ts: number }
    | { op: "error"; code: string; message: string };

export type EventListener = (envelope: EventEnvelope) => void;
export type StatusListener = (status: WsStatus) => void;

/**
 * Connection status emitted to subscribers.
 *
 * `degraded` is a superset of `closed` — it fires once the socket has
 * been continuously unreachable for `degradedAfterMs`, signalling to
 * the UI "give up waiting, switch to your fallback." Reconnect keeps
 * running in the background; we'll flip back to `open` the moment the
 * server returns.
 */
export type WsStatus = "connecting" | "open" | "closed" | "error" | "degraded";

export interface SentinelSocketOptions {
    channels?: string[];
    /** Max reconnect backoff ceiling in ms (default 8000). */
    backoffCapMs?: number;
    /** Seconds of unbroken disconnect before `degraded` fires (default 10000 ≈ one demo moment). */
    degradedAfterMs?: number;
    /** How often to send an op:ping while connected (default 15000). */
    heartbeatMs?: number;
    /** No frame from server for this long → force reconnect (default 30000). */
    staleTimeoutMs?: number;
}

const DEFAULTS = {
    backoffCapMs: 8000,
    degradedAfterMs: 10000,
    heartbeatMs: 15000,
    staleTimeoutMs: 30000,
} as const;

export class SentinelSocket {
    private socket: WebSocket | null = null;
    private readonly channels: Set<string>;
    private readonly listeners = new Set<EventListener>();
    private readonly statusListeners = new Set<StatusListener>();
    private reconnectTimer = 0;
    private backoff = 500;
    private shouldReconnect = true;
    private _status: WsStatus = "closed";
    private readonly opts: Required<Omit<SentinelSocketOptions, "channels">>;
    private heartbeatTimer = 0;
    private staleTimer = 0;
    private degradedTimer = 0;
    private disconnectedSince = 0;
    private readonly onOnline = () => this.handleOnline();
    private readonly onOffline = () => this.handleOffline();
    private networkListenersBound = false;

    constructor(channelsOrOpts: string[] | SentinelSocketOptions = ["events.all"]) {
        const opts: SentinelSocketOptions = Array.isArray(channelsOrOpts)
            ? { channels: channelsOrOpts }
            : channelsOrOpts;
        this.channels = new Set(opts.channels ?? ["events.all"]);
        this.opts = {
            backoffCapMs: opts.backoffCapMs ?? DEFAULTS.backoffCapMs,
            degradedAfterMs: opts.degradedAfterMs ?? DEFAULTS.degradedAfterMs,
            heartbeatMs: opts.heartbeatMs ?? DEFAULTS.heartbeatMs,
            staleTimeoutMs: opts.staleTimeoutMs ?? DEFAULTS.staleTimeoutMs,
        };
    }

    get status(): WsStatus {
        return this._status;
    }

    /** Milliseconds the socket has been continuously disconnected, or 0 if open. */
    get disconnectedMs(): number {
        return this.disconnectedSince === 0 ? 0 : Date.now() - this.disconnectedSince;
    }

    connect(): void {
        if (
            this.socket &&
            (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
        )
            return;
        this.shouldReconnect = true;
        this.bindNetworkListeners();
        // Browsers on an offline NIC will reject the connect synchronously
        // or immediately fire `close`. Don't bother; wait for `online`.
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            this.setStatus("closed");
            this.markDisconnected();
            return;
        }
        this.setStatus("connecting");

        try {
            this.socket = new WebSocket(wsUrl());
        } catch {
            this.setStatus("error");
            this.markDisconnected();
            this.scheduleReconnect();
            return;
        }

        this.socket.addEventListener("open", () => {
            this.backoff = 500;
            this.disconnectedSince = 0;
            this.clearDegradedTimer();
            this.setStatus("open");
            this.send({ op: "hello", version: "1.0" });
            for (const ch of this.channels) this.send({ op: "subscribe", channel: ch });
            this.startHeartbeat();
            this.bumpStaleTimer();
        });

        this.socket.addEventListener("message", (ev) => {
            // Any frame — event or pong — proves the server is alive.
            this.bumpStaleTimer();
            let msg: SentinelEvent;
            try {
                msg = JSON.parse(String(ev.data)) as SentinelEvent;
            } catch {
                return;
            }
            if (msg.op === "event") {
                for (const l of this.listeners) l(msg.data);
            }
        });

        this.socket.addEventListener("close", () => {
            this.stopHeartbeat();
            this.clearStaleTimer();
            this.setStatus("closed");
            this.markDisconnected();
            if (this.shouldReconnect) this.scheduleReconnect();
        });

        this.socket.addEventListener("error", () => {
            this.setStatus("error");
            this.markDisconnected();
        });
    }

    close(): void {
        this.shouldReconnect = false;
        this.clearReconnectTimer();
        this.stopHeartbeat();
        this.clearStaleTimer();
        this.clearDegradedTimer();
        this.unbindNetworkListeners();
        this.socket?.close();
        this.socket = null;
    }

    onEvent(l: EventListener): () => void {
        this.listeners.add(l);
        return () => this.listeners.delete(l);
    }

    onStatus(l: StatusListener): () => void {
        this.statusListeners.add(l);
        l(this._status);
        return () => this.statusListeners.delete(l);
    }

    private setStatus(s: WsStatus): void {
        if (s === this._status) return;
        this._status = s;
        for (const l of this.statusListeners) l(s);
    }

    private send(obj: unknown): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify(obj));
    }

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;
        if (this.reconnectTimer) return;
        // Cap + Jitter (AWS blog / Marc Brooker): sleep = random(0, backoff).
        // Prevents N tabs from hammering the server in lockstep after a
        // wifi reconnect.
        const cap = this.opts.backoffCapMs;
        const jittered = Math.floor(Math.random() * Math.min(this.backoff, cap));
        this.backoff = Math.min(this.backoff * 2, cap);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = 0;
            this.connect();
        }, jittered) as unknown as number;
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = 0;
        }
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            this.send({ op: "ping", ts: Date.now() });
        }, this.opts.heartbeatMs) as unknown as number;
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = 0;
        }
    }

    private bumpStaleTimer(): void {
        this.clearStaleTimer();
        this.staleTimer = setTimeout(() => {
            // Server went silent — tear the socket down so reconnect fires.
            // A stuck TCP connection can sit in "open" for minutes on a
            // captive-portal WiFi; this is the only way out.
            this.socket?.close();
        }, this.opts.staleTimeoutMs) as unknown as number;
    }

    private clearStaleTimer(): void {
        if (this.staleTimer) {
            clearTimeout(this.staleTimer);
            this.staleTimer = 0;
        }
    }

    private markDisconnected(): void {
        if (this.disconnectedSince === 0) this.disconnectedSince = Date.now();
        if (this.degradedTimer) return;
        this.degradedTimer = setTimeout(() => {
            this.degradedTimer = 0;
            if (this._status !== "open") this.setStatus("degraded");
        }, this.opts.degradedAfterMs) as unknown as number;
    }

    private clearDegradedTimer(): void {
        if (this.degradedTimer) {
            clearTimeout(this.degradedTimer);
            this.degradedTimer = 0;
        }
    }

    private bindNetworkListeners(): void {
        if (this.networkListenersBound) return;
        if (typeof globalThis.addEventListener !== "function") return;
        globalThis.addEventListener("online", this.onOnline);
        globalThis.addEventListener("offline", this.onOffline);
        this.networkListenersBound = true;
    }

    private unbindNetworkListeners(): void {
        if (!this.networkListenersBound) return;
        if (typeof globalThis.removeEventListener !== "function") return;
        globalThis.removeEventListener("online", this.onOnline);
        globalThis.removeEventListener("offline", this.onOffline);
        this.networkListenersBound = false;
    }

    private handleOnline(): void {
        // NIC came back. Reset backoff and try immediately.
        this.backoff = 500;
        this.clearReconnectTimer();
        if (this.shouldReconnect) this.connect();
    }

    private handleOffline(): void {
        // Don't burn retries while the NIC is down.
        this.clearReconnectTimer();
        this.socket?.close();
        this.setStatus("closed");
        this.markDisconnected();
    }
}
