-- L2 proof cache for the zk-prover service. Keyed by a content hash of
-- the guest inputs so identical inputs return byte-identical proofs
-- across restarts and service boundaries.
CREATE TABLE IF NOT EXISTS proof_cache (
    input_hash CHAR(64) NOT NULL,
    circuit TEXT NOT NULL,
    seal BYTEA NOT NULL,
    public_inputs JSONB NOT NULL,
    journal BYTEA NOT NULL,
    image_id CHAR(66) NOT NULL,
    elapsed_ms INTEGER NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    hit_count INTEGER NOT NULL DEFAULT 0,
    last_hit_at TIMESTAMPTZ,
    PRIMARY KEY (input_hash, circuit)
);

CREATE INDEX IF NOT EXISTS idx_proof_cache_circuit ON proof_cache (circuit);
CREATE INDEX IF NOT EXISTS idx_proof_cache_generated ON proof_cache (generated_at DESC);
