-- Data retention policy: auto-delete audit logs older than 90 days
-- This is enforced by a scheduled cleanup, not a database-level policy.
-- The migration just adds an index to make the cleanup efficient.

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at);

-- Add a comment documenting the retention policy
COMMENT ON TABLE audit_log IS 'Immutable audit trail. Retention: 90 days. Cleanup via scripts/cleanup-retention.sh';
