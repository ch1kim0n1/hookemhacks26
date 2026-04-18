import type Redis from "ioredis";
import type { TenantStreamRouter } from "./tenant-router.js";

export interface PublisherOptions {
    maxLen?: number;
    router?: TenantStreamRouter;
}

export class StreamPublisher {
    private redis: Redis;
    private maxLen: number;
    private router?: TenantStreamRouter;

    constructor(redis: Redis, opts?: PublisherOptions) {
        this.redis = redis;
        this.maxLen = opts?.maxLen ?? 10_000;
        this.router = opts?.router;
    }

    async publish(stream: string, data: Record<string, unknown>): Promise<string> {
        const resolvedStream = this.router ? this.router.resolve(stream) : stream;
        const id = await this.redis.xadd(
            resolvedStream,
            "MAXLEN",
            "=",
            String(this.maxLen),
            "*",
            "data",
            JSON.stringify(data),
        );
        return id ?? "";
    }
}
