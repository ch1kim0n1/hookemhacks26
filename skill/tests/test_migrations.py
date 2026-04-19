"""Tests for Alembic migrations."""

import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch

from skill import db


class TestDatabaseMigrations:
    def test_run_migrations_creates_threat_cache_table(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_db = Path(tmpdir) / "test.db"
            with patch.object(db, "DB_PATH", tmp_db):
                db.run_migrations()
            conn = sqlite3.connect(tmp_db)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='threat_cache'"
            )
            assert cursor.fetchone() is not None
            cursor.execute("PRAGMA table_info(threat_cache)")
            columns = {row[1] for row in cursor.fetchall()}
            expected = {
                "pattern_hash",
                "category",
                "sample_redacted",
                "reporter",
                "block_number",
                "cached_at",
            }
            assert expected.issubset(columns), f"Missing columns: {expected - columns}"
            conn.close()

    def test_run_migrations_creates_detection_log_table(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_db = Path(tmpdir) / "test.db"
            with patch.object(db, "DB_PATH", tmp_db):
                db.run_migrations()
            conn = sqlite3.connect(tmp_db)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='detection_log'"
            )
            assert cursor.fetchone() is not None
            cursor.execute("PRAGMA table_info(detection_log)")
            columns = {row[1] for row in cursor.fetchall()}
            expected = {
                "id",
                "timestamp",
                "tool_name",
                "modality",
                "verdict",
                "confidence",
                "reasons",
                "content_hash",
                "content_preview",
                "source_manifest",
            }
            assert expected.issubset(columns), f"Missing columns: {expected - columns}"
            conn.close()

    def test_run_migrations_creates_indexes(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_db = Path(tmpdir) / "test.db"
            with patch.object(db, "DB_PATH", tmp_db):
                db.run_migrations()
            conn = sqlite3.connect(tmp_db)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_detection_ts'"
            )
            assert cursor.fetchone() is not None
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_threat_category'"
            )
            assert cursor.fetchone() is not None
            conn.close()

    def test_run_migrations_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_db = Path(tmpdir) / "test.db"
            with patch.object(db, "DB_PATH", tmp_db):
                db.run_migrations()
                db.run_migrations()
            conn = sqlite3.connect(tmp_db)
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
            count = cursor.fetchone()[0]
            assert count >= 2
            conn.close()

    def test_init_db_calls_run_migrations(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_db = Path(tmpdir) / "test.db"
            with patch.object(db, "DB_PATH", tmp_db):
                db.init_db()
            conn = sqlite3.connect(tmp_db)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='threat_cache'"
            )
            assert cursor.fetchone() is not None
            conn.close()


class TestAlembicIntegration:
    def test_alembic_version_table_is_created(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_db = Path(tmpdir) / "test.db"
            with patch.object(db, "DB_PATH", tmp_db):
                db.run_migrations()
            conn = sqlite3.connect(tmp_db)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'"
            )
            assert cursor.fetchone() is not None
            conn.close()
