"""Shared fixtures for skill tests."""

import pytest

from skill import db


@pytest.fixture(scope="session", autouse=True)
def _init_skill_database() -> None:
    """Ensure SQLite schema exists for tests that use skill.db directly."""
    db.init_db()
