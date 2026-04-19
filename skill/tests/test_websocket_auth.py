"""WebSocket auth helpers and content redaction."""

from unittest.mock import patch

from skill.api import _validate_bearer_token
from skill.db import redact_content_preview


def test_validate_bearer_token_succeeds_with_correct_token():
    with patch.dict("os.environ", {"WS_BEARER_TOKEN": "secret123"}):
        assert _validate_bearer_token("secret123") is True


def test_validate_bearer_token_fails_with_wrong_token():
    with patch.dict("os.environ", {"WS_BEARER_TOKEN": "secret123"}):
        assert _validate_bearer_token("wrong_token") is False


def test_validate_bearer_token_fails_when_not_set():
    with patch.dict("os.environ", {}, clear=True):
        assert _validate_bearer_token("any_token") is False


def test_redact_content_preview_removes_email():
    preview = "Attack from user@example.com with payload..."
    redacted = redact_content_preview(preview)
    assert "[EMAIL]" in redacted
    assert "user@example.com" not in redacted


def test_redact_content_preview_removes_phone():
    preview = "Call 555-123-4567 for support"
    redacted = redact_content_preview(preview)
    assert "[PHONE]" in redacted


def test_redact_content_preview_removes_ipv4():
    preview = "Source IP 192.168.1.100 blocked"
    redacted = redact_content_preview(preview)
    assert "[IP]" in redacted
    assert "192.168.1.100" not in redacted


def test_redact_content_preview_truncates():
    long_text = "x" * 500
    redacted = redact_content_preview(long_text, max_len=100)
    assert len(redacted) == 100
