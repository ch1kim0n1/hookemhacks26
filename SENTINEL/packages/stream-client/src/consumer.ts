import type Redis from "ioredis";
import type { TenantStreamRouter } from "./tenant-router.js";

export interface StreamMessage {
    id: string;
    data: Record<string, unknown>;
}

export interface ConsumerOptions {
    stream: string;
    group: string;
    consumerName: string;
    handler: (msg: StreamMessage) => Promise<void>;
    blockMs?: number;
    autoAck?: boolean;
    count?: number;
    router?: TenantStreamRouter;
}

export class StreamConsumer {
    private redis: Redis;
    private opts: Required<Omit<ConsumerOptions, "handler" | "router">> & { handler: ConsumerOptions["handler"] };
    private running = false;

    constructor(redis: Redis, opts: ConsumerOptions) {
        this.redis = redis;
        const router = opts.router;
        this.opts = {
            blockMs: 5000,
            autoAck: true,
            count: 10,
            ...opts,
            stream: router ? router.resolve(opts.stream) : opts.stream,
            group: router ? router.resolveGroup(opts.group) : opts.group,
        };
    }

    async start(): Promise<void> {
        this.running = true;
        await this.ensureGroup();
        await this.processPending();
        this.poll();
    }

    async stop(): Promise<void> {
        this.running = false;
    }

    async ack(messageId: string): Promise<void> {
        await this.redis.xack(this.opts.stream, this.opts.group, messageId);
    }

    private async ensureGroup(): Promise<void> {
        try {
            await this.redis.xgroup("CREATE", this.opts.stream, this.opts.group, "0", "MKSTREAM");
        } catch (err: any) {
            if (!err.message?.includes("BUSYGROUP")) throw err;
        }
    }

    private async processPending(): Promise<void> {
        // First, re-process messages pending for this consumer (own deliveries)
        while (this.running) {
            const results = await this.redis.xreadgroup(
                "GROUP",
                this.opts.group,
                this.opts.consumerName,
                "COUNT",
                String(this.opts.count),
                "STREAMS",
                this.opts.stream,
                "0",
            );
            if (!results || (results as any[]).length === 0) break;
            const [, messages] = (results as any[])[0] as [string, [string, string[]][]];
            if (messages.length === 0) break;
            for (const [id, fields] of messages) {
                await this.dispatch(id, fields);
            }
        }

        // Second, claim and process messages pending for OTHER consumers (dead-letter recovery)
        await this.claimOrphanedPending();
    }

    private async claimOrphanedPending(): Promise<void> {
        // Use XPENDING to enumerate all pending entries across the entire group
        let startId = "-";
        while (this.running) {
            // XPENDING <stream> <group> <start> <end> <count>
            const pending = (await (this.redis as any).xpending(
                this.opts.stream,
                this.opts.group,
                startId,
                "+",
                String(this.opts.count),
            )) as Array<[string, string, number, number]>;

            if (!pending || pending.length === 0) break;

            for (const entry of pending) {
                const [msgId, owner] = entry;
                if (owner === this.opts.consumerName) continue; // already ours, handled above

                // XCLAIM transfers ownership so we can process it
                const claimed = (await (this.redis as any).xclaim(
                    this.opts.stream,
                    this.opts.group,
                    this.opts.consumerName,
                    "0", // min-idle-time ms — claim regardless of age
                    msgId,
                )) as Array<[string, string[]]>;

                for (const [id, fields] of claimed) {
                    await this.dispatch(id, fields);
                }
            }

            // Advance cursor past the last seen id
            const lastId = pending[pending.length - 1][0];
            if (pending.length < this.opts.count) break;
            // Move cursor just past lastId by incrementing the sequence number
            const parts = lastId.split("-");
            startId = `${parts[0]}-${Number(parts[1]) + 1}`;
        }
    }

    private poll(): void {
        if (!this.running) return;
        this.redis
            .xreadgroup(
                "GROUP",
                this.opts.group,
                this.opts.consumerName,
                "COUNT",
                String(this.opts.count),
                "BLOCK",
                String(this.opts.blockMs),
                "STREAMS",
                this.opts.stream,
                ">",
            )
            .then(async (results) => {
                if (results) {
                    const [, messages] = (results as any[])[0] as [string, [string, string[]][]];
                    for (const [id, fields] of messages) {
                        await this.dispatch(id, fields);
                    }
                }
                this.poll();
            })
            .catch((err) => {
                if (this.running) {
                    console.error(`StreamConsumer error: ${err.message}`);
                    setTimeout(() => this.poll(), 1000);
                }
            });
    }

    private async dispatch(id: string, fields: string[]): Promise<void> {
        const fieldMap: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
            fieldMap[fields[i]] = fields[i + 1];
        }
        const data = fieldMap.data ? JSON.parse(fieldMap.data) : fieldMap;
        const msg: StreamMessage = { id, data };
        try {
            await this.opts.handler(msg);
            if (this.opts.autoAck) {
                await this.ack(id);
            }
        } catch (err) {
            console.error(`StreamConsumer handler error for ${id}: ${err}`);
        }
    }
}
