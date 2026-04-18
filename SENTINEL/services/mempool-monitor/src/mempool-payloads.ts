import type { TxFeatures } from "./features.js";

/** Redis stream keys — must stay aligned with `absolute-docs/03_off_chain_services.md`. */
export const STREAM_MEMPOOL_PENDING = "sentinel.mempool.pending" as const;
export const STREAM_MEMPOOL_BLOCK = "sentinel.mempool.block" as const;

export function buildPendingTxEnvelope(features: TxFeatures) {
    return {
        schema: "PendingTxEvent@1" as const,
        observedAt: new Date(features.timestamp).toISOString(),
        tx: features,
    };
}

export function buildBlockEnvelope(blockNumber: number, observedAt: Date = new Date()) {
    return {
        schema: "BlockEvent@1" as const,
        observedAt: observedAt.toISOString(),
        blockNumber,
    };
}
