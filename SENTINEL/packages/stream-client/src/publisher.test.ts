import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StreamPublisher } from "./publisher.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const waitForRedis = async (redisUrl: string, timeoutMs = 15000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
        const probe = new Redis(redisUrl, {
            lazyConnect: true,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
            retryStrategy: () => null,
        });
        probe.on("error", () => {
            // Prevent noisy unhandled error events during readiness probing.
        });

        try {
            await probe.connect();
            await probe.ping();
            await probe.quit();
            return;
        } catch (error) {
            lastError = error;
            probe.disconnect();
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }

    throw new Error(`Redis at ${redisUrl} was not ready within ${timeoutMs}ms: ${String(lastError)}`);
};

describe("StreamPublisher", () => {
    let redis: Redis;
    let publisher: StreamPublisher;

    beforeAll(async () => {
        await waitForRedis(REDIS_URL);
        redis = new Redis(REDIS_URL);
        redis.on("error", () => {
            // Keep CI logs focused; explicit command failures still fail tests.
        });
        publisher = new StreamPublisher(redis);
    }, 20000);

    afterAll(async () => {
        await redis.del("test.stream");
        await redis.quit();
    });

    it("publishes a message to a stream with MAXLEN trim", async () => {
        const id = await publisher.publish("test.stream", {
            schema: "TestEvent@1",
            value: "hello",
        });
        expect(id).toBeTruthy();
        expect(typeof id).toBe("string");

        const messages = await redis.xrange("test.stream", "-", "+");
        expect(messages.length).toBeGreaterThanOrEqual(1);
        const last = messages[messages.length - 1];
        const fields = Object.fromEntries(
            last[1].reduce((acc: string[][], _, i, arr) => {
                if (i % 2 === 0) acc.push([arr[i], arr[i + 1]]);
                return acc;
            }, []),
        );
        expect(JSON.parse(fields.data)).toMatchObject({
            schema: "TestEvent@1",
            value: "hello",
        });
    }, 10000);

    it("respects maxLen", async () => {
        const pub = new StreamPublisher(redis, { maxLen: 5 });
        for (let i = 0; i < 10; i++) {
            await pub.publish("test.stream.small", { i });
        }
        const len = await redis.xlen("test.stream.small");
        expect(len).toBeLessThanOrEqual(7);
        await redis.del("test.stream.small");
    }, 10000);
});
