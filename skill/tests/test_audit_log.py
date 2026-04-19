"""Tests for audit logging."""

import tempfile
from pathlib import Path
from unittest.mock import patch

from skill import db


def test_audit_log_inserts_entry():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_db = Path(tmpdir) / "test.db"
        with patch.object(db, "DB_PATH", tmp_db):
            db.run_migrations()
            db.audit_log("test_action", resource="test_resource", result="success")
        with patch.object(db, "DB_PATH", tmp_db):
            logs = db.get_audit_logs(action="test_action")
        assert len(logs) == 1
        assert logs[0]["action"] == "test_action"
        assert logs[0]["resource"] == "test_resource"


def test_audit_log_filters_by_action():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_db = Path(tmpdir) / "test.db"
        with patch.object(db, "DB_PATH", tmp_db):
            db.run_migrations()
            db.audit_log("action_a", result="success")
            db.audit_log("action_b", result="success")
        with patch.object(db, "DB_PATH", tmp_db):
            logs_a = db.get_audit_logs(action="action_a")
            logs_b = db.get_audit_logs(action="action_b")
        assert len(logs_a) == 1
        assert len(logs_b) == 1
        assert logs_a[0]["action"] == "action_a"


def test_audit_log_includes_timestamp():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_db = Path(tmpdir) / "test.db"
        with patch.object(db, "DB_PATH", tmp_db):
            db.run_migrations()
            db.audit_log("test", result="success")
        with patch.object(db, "DB_PATH", tmp_db):
            logs = db.get_audit_logs()
        assert "timestamp" in logs[0]
        assert logs[0]["timestamp"] > 0
