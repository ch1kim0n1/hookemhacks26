-- Append-only event store for WebSocket / replay (demo + ops).
CREATE TABLE IF NOT EXISTS event_store (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id),
    kind TEXT NOT NULL,
    payload JSONB NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_store_observed ON event_store (observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_store_kind ON event_store (kind);
