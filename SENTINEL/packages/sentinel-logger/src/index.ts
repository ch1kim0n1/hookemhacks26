import { createRequire } from "node:module";
import pinoImport from "pino";
import type { Logger, LoggerOptions } from "pino";

export type { Logger } from "pino";

const require = createRequire(import.meta.url);

/** pino@8 default export typing under NodeNext can be the module namespace — normalize to callable. */
const pino = pinoImport as unknown as (opts: LoggerOptions) => Logger;

function resolvePrettyTransport(): LoggerOptions["transport"] | undefined {
    const wantPretty =
        process.env.PINO_PRETTY === "1" || (process.env.NODE_ENV !== "production" && process.env.PINO_PRETTY !== "0");
    if (!wantPretty) return undefined;
    try {
        require.resolve("pino-pretty");
        return {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:standard" },
        };
    } catch {
        return undefined;
    }
}

/**
 * Structured JSON logging for all TypeScript services. Set `PINO_PRETTY=1` for
 * readable lines when `pino-pretty` is installed in the consuming package.
 */
export function createServiceLogger(service: string): Logger {
    const base: LoggerOptions = {
        level: process.env.LOG_LEVEL ?? "info",
        name: service,
        base: { service },
    };
    const transport = resolvePrettyTransport();
    return transport ? pino({ ...base, transport }) : pino(base);
}
