# `@sentinel/stream-client`

Redis-stream helpers shared by every TypeScript service. Handles consumer-group ergonomics, JSON codec, schema-validated boundary reads, and graceful reconnect. Mirrors the Python equivalent in [../../services/shared-python/](../../services/shared-python/).

## Usage

```ts
import { createStreamClient } from "@sentinel/stream-client";

const stream = createStreamClient({ url: process.env.REDIS_URL! });

// Publish
await stream.publish("sentinel.mempool.pending", {
  schema: "PendingTxEvent@1",
  observedAt: new Date().toISOString(),
  tx: { hash, from, to },
});

// Consume (consumer-group)
await stream.consume({
  stream: "sentinel.detection.confirmed",
  group: "defense-agent",
  consumer: "defense-agent-1",
  handler: async (msg) => {
    // msg is already JSON-parsed and schema-validated
  },
});
```

## Responsibilities

- **Consumer-group bookkeeping** — creates groups on first use, tracks pending IDs, acks on successful handler return.
- **Schema validation at the boundary** — loads the relevant schema from [../../schemas/](../../schemas/), rejects malformed payloads to a dead-letter stream.
- **Reconnect** — exponential backoff with jitter; callers do not need to wrap.
- **Tracing hooks** — passes through context for OpenTelemetry spans if present.

## Not responsible for

- **Schema versioning.** Routing between `@1` and `@2` is the consumer's business — see [../../schemas/README.md](../../schemas/README.md).
- **Retry on business-logic failure.** A handler that throws gets its message re-queued; if the failure is non-transient, the consumer is responsible for dead-lettering.

## Tests

```bash
pnpm --filter @sentinel/stream-client test
```

Unit-tests run against redis-memory-server; CI exercises the real Redis 7 service on every PR.
