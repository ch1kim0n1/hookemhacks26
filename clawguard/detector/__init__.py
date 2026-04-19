"""Content detection pipeline — delegates to :mod:`detector.verdict`."""

from detector.verdict import detect

__all__ = ["detect"]
