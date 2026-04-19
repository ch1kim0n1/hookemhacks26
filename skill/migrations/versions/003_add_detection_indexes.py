"""Add composite indexes for detection_log filtering/pagination.

Revision ID: 003
Revises: 002
"""

from alembic import op

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Filtering by verdict + recent-first is the hot path for the dashboard
    # attacks feed and the /api/stats hourly aggregation.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_detection_verdict_ts "
        "ON detection_log(verdict, timestamp DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_detection_content_hash "
        "ON detection_log(content_hash)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_threat_cached_at "
        "ON threat_cache(cached_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_threat_cached_at")
    op.execute("DROP INDEX IF EXISTS idx_detection_content_hash")
    op.execute("DROP INDEX IF EXISTS idx_detection_verdict_ts")
