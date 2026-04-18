export interface ThreatSignature {
    /** Hash of the attack pattern (keccak256 of selector + target pattern) */
    signatureHash: string;
    /** Defense primitive to apply */
    defensePrimitive: string;
    /** Confidence in basis points (0-10000) */
    confidence: number;
    /** Proof of derivation (from learning loop) */
    derivationProof: string;
    /** Source: which learning generation produced this */
    sourceGeneration: number;
    /** Pattern name */
    pattern: string;
}

export interface PreemptiveAction {
    /** Target protocol to pause */
    targetProtocol: string;
    /** The threat signature that triggered this */
    signatureHash: string;
    /** Transaction hash that matched */
    matchingTxHash: string;
    /** Action taken */
    action: "pause" | "alert";
    /** Transaction hash of the defense (if pause) */
    defenseTxHash?: string;
}

export interface StrikeEngineConfig {
    rpcUrl: string;
    redisUrl: string;
    addressesPath: string;
    /** Private key for submitting defense txs */
    operatorKey: string;
    /** How often to scan mempool for matches (ms) */
    scanIntervalMs: number;
}
