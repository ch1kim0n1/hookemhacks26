"""Add audit_log table."""

from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            action TEXT NOT NULL,
            resource TEXT,
            user_id TEXT,
            detail TEXT,
            result TEXT
        )
        """
    )
    op.execute("CREATE INDEX idx_audit_ts ON audit_log(timestamp)")
    op.execute("CREATE INDEX idx_audit_action ON audit_log(action)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_audit_action")
    op.execute("DROP INDEX IF EXISTS idx_audit_ts")
    op.execute("DROP TABLE IF EXISTS audit_log")
