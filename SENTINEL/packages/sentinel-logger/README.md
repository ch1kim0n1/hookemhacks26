# `@sentinel/logger`

Structured logger shared by every TypeScript service in [../../services/](../../services/). Pino-based; JSON to stdout, human-friendly in dev.

## Usage

```ts
import { logger } from "@sentinel/logger";

const log = logger.child({ service: "mempool-monitor" });
log.info({ txHash }, "pending tx observed");
log.error({ err: err.message }, "rpc call failed");
```

## Conventions

- **Always attach a `service` field** via `logger.child({ service: "…" })` at module load.
- **Structured first, message second.** `log.info({ eventId, confidence }, "verdict")` not `` log.info(`verdict ${eventId}`) ``.
- **`err.message` only.** Full stack traces are captured by Pino automatically when you pass an `Error`; avoid interpolating them into the message string.

Log level is controlled by `LOG_LEVEL` env (default `info`). In dev, pipe through `pino-pretty`:

```bash
pnpm --filter @sentinel/api-gateway dev | pnpm exec pino-pretty
```
