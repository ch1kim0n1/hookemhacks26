# SENTINEL SOC2 Compliance Checklist

Status: **In Progress** (Learning Project)
Last reviewed: 2026-04-15

This checklist maps SENTINEL's controls to SOC2 Trust Service Criteria.
Not all criteria are applicable — this focuses on the subset relevant to
a blockchain defense SaaS.

## CC1: Control Environment

| Control | Status | Implementation |
|---------|--------|----------------|
| Organizational structure defined | N/A | Single-operator learning project |
| Code of conduct | N/A | |

## CC2: Communication and Information

| Control | Status | Implementation |
|---------|--------|----------------|
| Audit logging of all state changes | ✅ Done | `audit_log` table, `registerAuditHook()` |
| Audit log retention policy | ✅ Done | 90 days, `scripts/cleanup-retention.sh` |
| Audit log immutability | ✅ Done | INSERT-only on audit_log (no UPDATE/DELETE grants for sentinel_app) |
| Audit log queryable | ✅ Done | `GET /api/v1/admin/audit` |

## CC3: Risk Assessment

| Control | Status | Implementation |
|---------|--------|----------------|
| Threat model documented | ✅ Done | `absolute-docs/00_executive_overview.md` |
| Risk register | ✅ Done | `absolute-docs/09_hackathon_mvp_scope.md` §Risk Register |

## CC5: Control Activities

| Control | Status | Implementation |
|---------|--------|----------------|
| Authentication required | ✅ Done | JWT HS256/RS256 on all non-public routes |
| RBAC enforced | ✅ Done | admin/operator/viewer roles, `rbacHook` |
| Multi-tenancy isolation | ✅ Done | Postgres RLS, tenant-scoped Redis Streams |
| Secret rotation mechanism | ✅ Done | `scripts/rotate-secrets.sh` |
| JWT key rotation | ✅ Done | `scripts/rotate-jwt-keys.sh` with overlap |
| TLS encryption in transit | ✅ Done | Caddy auto-TLS (production profile) |
| Data at rest (Postgres) | ⚠️ Partial | AOF for Redis, pg volume. Encryption at rest depends on host/cloud config |
| Data at rest (Redis) | ⚠️ Partial | AOF enabled, backup scripts exist |

## CC6: Logical and Physical Access Controls

| Control | Status | Implementation |
|---------|--------|----------------|
| JWKS public key distribution | ✅ Done | `/.well-known/jwks.json` |
| Non-root containers | ✅ Done | All Dockerfiles use `sentinel` user |
| Network segmentation | ✅ Done | Docker `sentinel-net` bridge network |
| Ports not exposed in production | ✅ Done | Caddy is sole entry point (production profile) |

## CC7: System Operations

| Control | Status | Implementation |
|---------|--------|----------------|
| Health endpoints | ✅ Done | All 6 services + frontend |
| Prometheus monitoring | ✅ Done | `/metrics` on all services |
| Grafana dashboards | ✅ Done | 5 provisioned dashboards |
| Service restart policies | ✅ Done | `restart: on-failure:5` |
| Redis HA (Sentinel) | ✅ Done | 3-node Sentinel (production) |
| Service redundancy | ✅ Done | Scaled api-gateway (production) |
| Backup automation | ✅ Done | `scripts/backup.sh` (daily cron) |
| Restore tested | ✅ Done | `docs/runbooks/restore.md` |

## CC8: Change Management

| Control | Status | Implementation |
|---------|--------|----------------|
| Database migrations versioned | ✅ Done | `services/api-gateway/migrations/*.sql` |
| Git history | ✅ Done | All changes committed with descriptive messages |
| Pre-deployment checks | ✅ Done | `scripts/check-production.sh` |

## CC9: Risk Mitigation

| Control | Status | Implementation |
|---------|--------|----------------|
| Disaster recovery runbook | ✅ Done | `docs/runbooks/restore.md` |
| Backup retention | ✅ Done | 7-day rolling (configurable) |
| Audit log retention | ✅ Done | 90-day (configurable) |

## Gaps (Future Work)

- [ ] Encryption at rest (cloud-level disk encryption)
- [ ] MFA for admin users
- [ ] Penetration testing
- [ ] SOC2 Type II audit by third party
- [ ] Incident response runbook
- [ ] Change approval workflow (PRs, review gates)
- [ ] Secrets in Vault (not .env files)
- [ ] Automated compliance scanning (e.g., Vanta, Drata)
