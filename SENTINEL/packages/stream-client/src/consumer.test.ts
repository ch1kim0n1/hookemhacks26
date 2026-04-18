import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StreamConsumer, type StreamMessage } from "./consumer.js";
import { StreamPublisher } from "./publisher.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const TEST_STREAM = "test.consumer.stream";
const TEST_GROUP = "test-group";

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

describe("StreamConsumer", () => {
    let redis: Redis;
    let publisher: StreamPublisher;

    beforeAll(async () => {
        await waitForRedis(REDIS_URL);
        redis = new Redis(REDIS_URL);
        redis.on("error", () => {
            // Keep CI logs focused; explicit command failures still fail tests.
        });
        publisher = new StreamPublisher(redis);
        await redis.del(TEST_STREAM);
    }, 20000);

    afterAll(async () => {
        await redis.del(TEST_STREAM);
        await redis.quit();
    });

    it("receives messages published to the stream", async () => {
        await publisher.publish(TEST_STREAM, { schema: "Test@1", n: 1 });
        await publisher.publish(TEST_STREAM, { schema: "Test@1", n: 2 });

        const received: StreamMessage[] = [];
        const consumerRedis = new Redis(REDIS_URL);
        const consumer = new StreamConsumer(consumerRedis, {
            stream: TEST_STREAM,
            group: TEST_GROUP,
            consumerName: "test-worker",
            handler: async (msg) => {
                received.push(msg);
            },
            blockMs: 500,
        });

        await consumer.start();
        await new Promise((r) => setTimeout(r, 2000));
        await consumer.stop();
        await consumerRedis.quit();

        expect(received.length).toBe(2);
        expect(received[0].data).toMatchObject({ schema: "Test@1", n: 1 });
        expect(received[1].data).toMatchObject({ schema: "Test@1", n: 2 });
    }, 15000);

    it("replays pending messages on restart", async () => {
        const stream = "test.consumer.replay";
        const group = "replay-group";
        await redis.del(stream);

        await publisher.publish(stream, { schema: "Test@1", val: "replay-me" });

        const consumerRedis1 = new Redis(REDIS_URL);
        const consumer1 = new StreamConsumer(consumerRedis1, {
            stream,
            group,
            consumerName: "worker-1",
            handler: async () => {
                // Intentionally don't complete — simulate crash by stopping
            },
            autoAck: false,
            blockMs: 500,
        });
        await consumer1.start();
        await new Promise((r) => setTimeout(r, 1500));
        await consumer1.stop();
        await consumerRedis1.quit();

        const replayed: StreamMessage[] = [];
        const consumerRedis2 = new Redis(REDIS_URL);
        const consumer2 = new StreamConsumer(consumerRedis2, {
            stream,
            group,
            consumerName: "worker-2",
            handler: async (msg) => {
                replayed.push(msg);
            },
            blockMs: 500,
        });
        await consumer2.start();
        await new Promise((r) => setTimeout(r, 2000));
        await consumer2.stop();
        await consumerRedis2.quit();

        expect(replayed.length).toBeGreaterThanOrEqual(1);
        expect(replayed[0].data).toMatchObject({ val: "replay-me" });

        await redis.del(stream);
    }, 15000);
});
