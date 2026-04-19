"""Graceful shutdown wiring."""

from skill import api


def test_shutdown_event_exists():
    assert api._shutdown_event is not None
