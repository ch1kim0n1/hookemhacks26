"""Initial schema: threat_cache, detection_log, and indexes.

Revision ID: 001
Revises:
Create Date: 2026-04-18

"""

from alembic import op

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE threat_cache (
            pattern_hash TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            sample_redacted TEXT,
            reporter TEXT,
            block_number INTEGER,
            cached_at INTEGER NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE detection_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            tool_name TEXT,
            modality TEXT,
            verdict TEXT NOT NULL,
            confidence REAL,
            reasons TEXT,
            content_hash TEXT,
            content_preview TEXT,
            source_manifest TEXT
        )
        """
    )
    op.execute("CREATE INDEX idx_detection_ts ON detection_log(timestamp)")
    op.execute("CREATE INDEX idx_threat_category ON threat_cache(category)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_threat_category")
    op.execute("DROP INDEX IF EXISTS idx_detection_ts")
    op.execute("DROP TABLE IF EXISTS detection_log")
    op.execute("DROP TABLE IF EXISTS threat_cache")
