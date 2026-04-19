"""Tests for secrets management."""

import os
from unittest.mock import patch

import pytest

from skill.config import secrets as secrets_module
from skill.config.secrets import (
    SecretsManager,
    get_secret,
    get_secrets_manager,
    init_secrets,
)


class TestSecretsManager:
    def test_init_with_env_source(self):
        sm = SecretsManager(source="env")
        assert sm.source == "env"

    def test_init_with_invalid_source_raises(self):
        with pytest.raises(ValueError, match="Unsupported secrets source"):
            SecretsManager(source="invalid")

    def test_get_reads_from_env(self):
        with patch.dict(os.environ, {"TEST_SECRET": "secret_value"}):
            sm = SecretsManager("env")
            assert sm.get("TEST_SECRET") == "secret_value"

    def test_get_required_missing_raises(self):
        with patch.dict(os.environ, {}, clear=True):
            sm = SecretsManager("env")
            with pytest.raises(ValueError, match="Required secret not found"):
                sm.get("NONEXISTENT_SECRET")

    def test_get_optional_uses_default(self):
        with patch.dict(os.environ, {}, clear=True):
            sm = SecretsManager("env")
            assert sm.get("NONEXISTENT_SECRET", default="default_value") == "default_value"

    def test_get_empty_secret_logs_warning(self):
        with patch.dict(os.environ, {"EMPTY_SECRET": ""}):
            with patch("skill.config.secrets.logger") as mock_logger:
                sm = SecretsManager("env")
                sm.get("EMPTY_SECRET")
                mock_logger.warning.assert_called_once()

    def test_vault_not_implemented(self):
        sm = SecretsManager("vault")
        with pytest.raises(NotImplementedError, match="Vault"):
            sm.get("ANY_KEY")


class TestGlobalSecretsAPI:
    def test_get_secret_reads_from_env(self):
        with patch.dict(os.environ, {"TEST_KEY": "test_value"}):
            assert get_secret("TEST_KEY") == "test_value"

    def test_get_secret_required_missing_raises(self):
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(ValueError, match="Required secret not found"):
                get_secret("NONEXISTENT")

    def test_get_secret_optional_uses_default(self):
        with patch.dict(os.environ, {}, clear=True):
            assert get_secret("OPTIONAL", default="default") == "default"

    def test_get_secret_auto_initializes_manager(self):
        original = secrets_module._secrets_manager
        try:
            secrets_module._secrets_manager = None
            with patch.dict(os.environ, {"TEST": "value"}):
                assert get_secret("TEST") == "value"
        finally:
            secrets_module._secrets_manager = original

    def test_init_secrets_creates_global_instance(self):
        manager = init_secrets("env")
        assert manager is not None
        assert manager.source == "env"

    def test_get_secrets_manager_returns_instance(self):
        init_secrets("env")
        manager = get_secrets_manager()
        assert manager is not None
        assert isinstance(manager, SecretsManager)


class TestIntegration:
    def test_publisher_can_get_secret(self):
        with patch.dict(os.environ, {"CLAWGUARD_PRIVATE_KEY": "test_key"}):
            from learning.publisher import publish_defense_update

            assert callable(publish_defense_update)

    def test_api_initialization_works(self):
        from skill.api import app

        assert app is not None
