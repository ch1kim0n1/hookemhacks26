"""SQLite database path (shared by skill.db and Alembic env — no side effects on import)."""

import os
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "clawguard.db"

if os.environ.get("VERCEL"):
    DB_PATH = Path("/tmp/clawguard.db")  # nosec B108
