# SENTINEL Restore Runbook

## Prerequisites
- Access to the VPS or docker host
- Backup files in `backups/` directory
- `psql` and `redis-cli` available

## Postgres Restore

1. List available backups:
   ```bash
   ls -lht backups/postgres/
   ```

2. Restore (WARNING: drops existing database):
   ```bash
   ./scripts/restore-postgres.sh backups/postgres/sentinel_YYYYMMDD_HHMMSS.sql.gz
   ```

3. Apply pending migrations:
   ```bash
   ./scripts/migrate.sh
   ```

4. Verify:
   ```bash
   psql postgresql://sentinel:sentinel@localhost:5432/sentinel -c "SELECT count(*) FROM tenants;"
   ```

## Redis Restore

1. List available backups:
   ```bash
   ls -lht backups/redis/
   ```

2. Restore (WARNING: replaces all Redis data):
   ```bash
   ./scripts/restore-redis.sh backups/redis/dump_YYYYMMDD_HHMMSS.rdb
   ```

3. Verify:
   ```bash
   redis-cli info keyspace
   ```

## Full System Restore (disaster recovery)

1. Ensure docker-compose infra is running:
   ```bash
   docker compose up -d anvil redis postgres
   ```

2. Restore Postgres (most recent backup):
   ```bash
   LATEST_PG=$(ls -t backups/postgres/*.sql.gz | head -1)
   ./scripts/restore-postgres.sh "$LATEST_PG"
   ./scripts/migrate.sh
   ```

3. Restore Redis:
   ```bash
   LATEST_REDIS=$(ls -t backups/redis/*.rdb | head -1)
   ./scripts/restore-redis.sh "$LATEST_REDIS"
   ```

4. Redeploy contracts (if chain state is lost):
   ```bash
   ./scripts/bootstrap.sh
   ```

5. Start services:
   ```bash
   docker compose up -d
   ```

6. Verify:
   ```bash
   ./scripts/check-production.sh
   ```

## Backup Schedule

Recommended cron (add to VPS crontab):
```
0 2 * * * cd /opt/sentinel && ./scripts/backup.sh >> /var/log/sentinel-backup.log 2>&1
```

This runs daily at 2am and retains 7 days of backups.
