"""Canonical SHA-256 identity for scanned text (cache + chain alignment)."""

from __future__ import annotations

import hashlib


def content_sha256_hex(text: str) -> str:
    """Full 64-char lowercase hex digest of UTF-8 content (matches ThreatRegistry bytes32)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
