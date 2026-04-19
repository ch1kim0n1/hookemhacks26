"""Tests for the AWS Secrets Manager backend on :class:`SecretsManager`."""

from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from skill.config.secrets import _AWS_SECRET_NAME_MAP, SecretsManager


class _SecretsManagerStub:
    def __init__(self, mapping: dict[str, str], *, fail_with: Exception | None = None):
        self.mapping = mapping
        self.fail_with = fail_with
        self.calls: list[str] = []

    def get_secret_value(self, *, SecretId: str):
        self.calls.append(SecretId)
        if self.fail_with is not None:
            raise self.fail_with
        if SecretId not in self.mapping:
            raise RuntimeError(f"no such secret: {SecretId}")
        return {"SecretString": self.mapping[SecretId]}


class TestAwsBackend:
    def test_reads_via_name_map(self):
        stub = _SecretsManagerStub({"clawguard/admin-token": "hunter2"})
        sm = SecretsManager("aws", aws_client=stub, aws_prefix="clawguard")

        assert sm.get("CLAWGUARD_ADMIN_TOKEN") == "hunter2"
        assert stub.calls == ["clawguard/admin-token"]

    def test_cache_hit_skips_aws(self):
        stub = _SecretsManagerStub({"clawguard/admin-token": "v1"})
        sm = SecretsManager("aws", aws_client=stub, aws_prefix="clawguard")

        sm.get("CLAWGUARD_ADMIN_TOKEN")
        sm.get("CLAWGUARD_ADMIN_TOKEN")
        sm.get("CLAWGUARD_ADMIN_TOKEN")

        assert len(stub.calls) == 1

    def test_cache_expires(self):
        stub = _SecretsManagerStub({"clawguard/admin-token": "v1"})
        sm = SecretsManager(
            "aws",
            aws_client=stub,
            aws_prefix="clawguard",
            cache_ttl_seconds=1,
        )

        sm.get("CLAWGUARD_ADMIN_TOKEN")
        # Move wall-clock forward past the TTL.
        with patch("skill.config.secrets.time.time", side_effect=lambda _t=time.time() + 10: _t):
            sm.get("CLAWGUARD_ADMIN_TOKEN")

        assert len(stub.calls) == 2

    def test_invalidate_cache_forces_refetch(self):
        stub = _SecretsManagerStub({"clawguard/admin-token": "v1"})
        sm = SecretsManager("aws", aws_client=stub, aws_prefix="clawguard")

        sm.get("CLAWGUARD_ADMIN_TOKEN")
        sm.invalidate_cache("CLAWGUARD_ADMIN_TOKEN")
        sm.get("CLAWGUARD_ADMIN_TOKEN")

        assert len(stub.calls) == 2

    def test_falls_back_to_env_on_aws_failure(self, monkeypatch):
        monkeypatch.setenv("CLAWGUARD_ADMIN_TOKEN", "from-env")
        stub = _SecretsManagerStub({}, fail_with=RuntimeError("denied"))
        sm = SecretsManager("aws", aws_client=stub, aws_prefix="clawguard")

        assert sm.get("CLAWGUARD_ADMIN_TOKEN") == "from-env"

    def test_unmapped_key_falls_through_to_slug(self):
        stub = _SecretsManagerStub({"clawguard/something-new": "ok"})
        sm = SecretsManager("aws", aws_client=stub, aws_prefix="clawguard")

        assert sm.get("SOMETHING_NEW") == "ok"

    def test_name_map_contains_all_known_tokens(self):
        # Canary: if someone adds a bearer token without wiring the map, the
        # prefix-name resolver silently slugifies it, which is fine but deserves
        # a conscious check here so we don't forget existing entries.
        assert "CLAWGUARD_ADMIN_TOKEN" in _AWS_SECRET_NAME_MAP
        assert "CLAWGUARD_METRICS_TOKEN" in _AWS_SECRET_NAME_MAP
        assert "CLAWGUARD_WS_TOKEN" in _AWS_SECRET_NAME_MAP


class TestSourceSelection:
    def test_rejects_unknown_source(self):
        with pytest.raises(ValueError):
            SecretsManager("elsewhere")

    def test_env_source_untouched(self, monkeypatch):
        monkeypatch.setenv("SOME_KEY", "value")
        sm = SecretsManager("env")
        assert sm.get("SOME_KEY") == "value"
