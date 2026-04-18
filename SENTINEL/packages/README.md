# `packages/` — Shared TypeScript Libraries

Internal packages consumed by services in [../services/](../services/) via pnpm workspace protocol. Not published externally.

| Package | Purpose |
|---|---|
| [@sentinel/logger](sentinel-logger/) | Pino-based structured logger, shared conventions |
| [@sentinel/stream-client](stream-client/) | Redis-stream consumer/producer with schema validation at the boundary |

The Python counterpart is [../services/shared-python/](../services/shared-python/).

## Adding a package

1. `mkdir packages/foo && cd packages/foo && pnpm init`
2. Set `"name": "@sentinel/foo"` and mark `"private": true`.
3. Add a `src/index.ts`, `tsconfig.json`, and a `build` script emitting `dist/`.
4. Reference from a service via `"@sentinel/foo": "workspace:*"`.
5. Write a short README following the two existing ones.
