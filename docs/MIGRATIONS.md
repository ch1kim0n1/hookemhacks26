# Database Migrations

ClawGuard uses [Alembic](https://alembic.sqlalchemy.org/) for schema version control.

## Adding a New Migration

When you change the schema (new column, table, index):

```bash
cd /path/to/clawguard

# Create a new revision (edit upgrade/downgrade manually; autogenerate is optional)
uv run alembic -c alembic.ini revision -m "describe_your_change"

# Implement upgrade() and downgrade() under skill/migrations/versions/

# Test
uv run pytest skill/tests/test_migrations.py -v

# Apply (or rely on API / serverless startup calling init_db)
make migrate
```

## Rollback

```bash
uv run alembic -c alembic.ini current
uv run alembic -c alembic.ini history

# One step back
uv run alembic -c alembic.ini downgrade -1

# Or to a specific revision
uv run alembic -c alembic.ini downgrade 001
```

## Practices

1. Always implement `downgrade()` when it is safe for your change.
2. Prefer small, focused migrations.
3. Use raw SQL via `op.execute(...)` — the app does not use an ORM for this store.
4. Add indexes for new query paths.
5. Migrations are tracked in `alembic_version`; re-running `upgrade head` is safe once applied.

Revisions live under `skill/migrations/versions/` (e.g. `001` initial schema, `002` audit log).

## Legacy SQLite files

If you already have a `clawguard.db` created by the old `CREATE TABLE IF NOT EXISTS` bootstrap, `run_migrations()` detects existing `threat_cache` without an Alembic revision and **stamps** the database at the current head instead of re-running the initial migration (which would fail with “table already exists”).

## Troubleshooting

- **`alembic: command not found`**: install project deps (`uv pip install -e ".[dev]"` or `make setup`).
- **`database is locked`**: SQLite; the migration env uses `StaticPool` for online runs. Avoid long-lived writers during migrate.
- **Stale local DB**: remove `clawguard.db` and run `make migrate` or start the API once.
