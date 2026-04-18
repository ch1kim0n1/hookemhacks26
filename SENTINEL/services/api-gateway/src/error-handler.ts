import { randomUUID } from "node:crypto";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface StandardError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    correlationId: string;
}

const ERROR_CODES: Record<number, string> = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "UNPROCESSABLE",
    500: "INTERNAL_ERROR",
    503: "SERVICE_UNAVAILABLE",
};

export function registerErrorHandler(app: FastifyInstance): void {
    // Add correlation ID to every request
    app.addHook("onRequest", async (req) => {
        (req as any).correlationId = (req.headers["x-correlation-id"] as string) ?? randomUUID();
    });

    // Add correlation ID to every response
    app.addHook("onSend", async (req, reply) => {
        reply.header("X-Correlation-Id", (req as any).correlationId);
    });

    // Standardize error responses
    app.setErrorHandler((error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
        const statusCode = error.statusCode ?? 500;
        const code = ERROR_CODES[statusCode] ?? "INTERNAL_ERROR";
        const correlationId = (req as any).correlationId ?? randomUUID();

        const body: StandardError = {
            code,
            message: error.message,
            correlationId,
        };

        if (statusCode < 500 && error.validation) {
            body.details = { validation: error.validation };
        }

        reply.status(statusCode).send(body);
    });
}
