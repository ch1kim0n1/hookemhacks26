"""Secrets management abstraction (env today; Vault-ready interface)."""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


class SecretsManager:
    """Read secrets from configured source (environment or future Vault)."""

    def __init__(self, source: str = "env") -> None:
        if source not in ("env", "vault"):
            raise ValueError(f"Unsupported secrets source: {source}. Supported: env, vault")
        self.source = source
        logger.info("SecretsManager initialized with source: %s", source)

    def get(self, key: str, default: str | None = None) -> str:
        if self.source == "env":
            return self._get_from_env(key, default)
        if self.source == "vault":
            return self._get_from_vault(key, default)
        raise RuntimeError(f"Unsupported source: {self.source}")

    def _get_from_env(self, key: str, default: str | None) -> str:
        value = os.environ.get(key, default)
        if value is None:
            raise ValueError(
                f"Required secret not found: {key}. Set environment variable: export {key}=<value>"
            )
        if not value:
            logger.warning("Secret %s is empty (empty string)", key)
        return value

    def _get_from_vault(self, _key: str, _default: str | None) -> str:
        raise NotImplementedError(
            "Vault support is not yet implemented. "
            "Please use environment variables (source='env') for now."
        )


_secrets_manager: SecretsManager | None = None


def init_secrets(source: str = "env") -> SecretsManager:
    global _secrets_manager
    _secrets_manager = SecretsManager(source)
    return _secrets_manager


def get_secret(key: str, default: str | None = None) -> str:
    global _secrets_manager
    if _secrets_manager is None:
        logger.debug("Secrets manager not initialized; using env source")
        init_secrets("env")
    assert _secrets_manager is not None
    return _secrets_manager.get(key, default)


def get_secrets_manager() -> SecretsManager:
    global _secrets_manager
    if _secrets_manager is None:
        init_secrets("env")
    assert _secrets_manager is not None
    return _secrets_manager
