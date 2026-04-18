import { spawn } from "node:child_process";
import { createServer } from "node:net";

// Port pool: reserve ports in a bounded range and track in-use across concurrent
// spawns. OS-assigned ports (port 0) can collide if two forks race between
// getFreePort() and spawn(), so we hold allocations in this Set until release.
const RESERVED_PORTS = new Set<number>();
const PORT_POOL_START = Number(process.env.ANVIL_PORT_POOL_START ?? 28545);
const PORT_POOL_END = Number(process.env.ANVIL_PORT_POOL_END ?? 28999);
let poolCursor = PORT_POOL_START;

function nextCandidate(): number {
    const span = PORT_POOL_END - PORT_POOL_START + 1;
    const p = poolCursor;
    poolCursor = PORT_POOL_START + ((p - PORT_POOL_START + 1) % span);
    return p;
}

async function probePort(port: number): Promise<boolean> {
    return await new Promise((resolve) => {
        const srv = createServer();
        srv.once("error", () => resolve(false));
        srv.listen(port, "127.0.0.1", () => {
            srv.close(() => resolve(true));
        });
    });
}

/**
 * Reserve a free port from the pool. Guards against concurrent callers by
 * recording reservations in RESERVED_PORTS until release(). The returned port
 * is validated both logically (not in our set) and physically (bindable).
 */
export async function acquirePort(): Promise<number> {
    const span = PORT_POOL_END - PORT_POOL_START + 1;
    for (let attempts = 0; attempts < span * 2; attempts++) {
        const candidate = nextCandidate();
        if (RESERVED_PORTS.has(candidate)) continue;
        if (await probePort(candidate)) {
            RESERVED_PORTS.add(candidate);
            return candidate;
        }
    }
    throw new Error(
        `no free anvil port in range ${PORT_POOL_START}-${PORT_POOL_END} (reserved: ${RESERVED_PORTS.size})`,
    );
}

export function releasePort(port: number): void {
    RESERVED_PORTS.delete(port);
}

/**
 * Legacy: returns an OS-assigned ephemeral port. Retained for tests that don't
 * need pool-backed reservation. Prefer acquirePort() for production paths.
 */
export async function getFreePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const srv = createServer();
        srv.listen(0, () => {
            const addr = srv.address();
            srv.close(() => {
                if (typeof addr === "object" && addr && "port" in addr) {
                    resolve(addr.port);
                } else {
                    reject(new Error("no port"));
                }
            });
        });
    });
}

export interface ForkOptions {
    forkUrl: string;
    forkBlock: number;
    timeoutMs?: number;
}

export interface AnvilFork {
    port: number;
    rpcUrl: string;
    dispose: () => Promise<void>;
}

export async function spawnFork(opts: ForkOptions): Promise<AnvilFork> {
    const port = await acquirePort();
    // Ensure anvil is discoverable even when the parent process had its
    // PATH stripped (e.g. nohup, docker, systemd). ANVIL_BIN wins if set.
    const anvilBin = process.env.ANVIL_BIN ?? "anvil";
    const defaultPath = [
        process.env.HOME ? `${process.env.HOME}/.foundry/bin` : "",
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
    ]
        .filter(Boolean)
        .join(":");
    const childEnv = {
        ...process.env,
        PATH: `${process.env.PATH ?? ""}:${defaultPath}`,
    };
    const proc = spawn(
        anvilBin,
        [
            "--fork-url",
            opts.forkUrl,
            "--fork-block-number",
            String(opts.forkBlock),
            "--port",
            String(port),
            "--hardfork",
            "cancun",
            "--silent",
        ],
        { stdio: ["ignore", "pipe", "pipe"], env: childEnv },
    );
    let spawnError: { message: string } | null = null;
    proc.on("error", (err: Error) => {
        spawnError = { message: err.message };
    });

    const rpcUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + (opts.timeoutMs ?? 20000);
    while (Date.now() < deadline) {
        const err = spawnError as { message: string } | null;
        if (err !== null) {
            releasePort(port);
            throw new Error(`anvil spawn failed (is 'anvil' on PATH? set ANVIL_BIN if not): ${err.message}`);
        }
        try {
            const r = await fetch(rpcUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_blockNumber",
                    params: [],
                }),
            });
            if (r.ok) {
                return {
                    port,
                    rpcUrl,
                    dispose: async () => {
                        proc.kill("SIGTERM");
                        await new Promise<void>((resolve) => {
                            const t = setTimeout(() => {
                                proc.kill("SIGKILL");
                                resolve();
                            }, 2000);
                            proc.on("exit", () => {
                                clearTimeout(t);
                                resolve();
                            });
                        });
                        releasePort(port);
                    },
                };
            }
        } catch {
            /* still starting */
        }
        await new Promise((r) => setTimeout(r, 150));
    }
    proc.kill("SIGTERM");
    releasePort(port);
    throw new Error(`fork on :${port} did not come up in ${opts.timeoutMs ?? 20000}ms`);
}
