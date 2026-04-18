-- Enable RLS on tenant-scoped tables
ALTER TABLE tenant_protocol_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Create app role for the API (if not exists)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_app') THEN
        CREATE ROLE sentinel_app LOGIN PASSWORD 'sentinel_app';
    END IF;
END $$;

-- Grant table access to app role
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO sentinel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_protocol_addresses TO sentinel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO sentinel_app;
GRANT SELECT, INSERT ON audit_log TO sentinel_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sentinel_app;

-- RLS policies: filter by current_setting('app.current_tenant_id')
CREATE POLICY tenant_isolation_addresses ON tenant_protocol_addresses
    USING (tenant_id::text = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id::text = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_audit ON audit_log
    USING (tenant_id::text = current_setting('app.current_tenant_id', true));

-- Tenants table is readable by all (admin operations check role in app code)
-- No RLS on tenants table itself — admin-only routes control access
