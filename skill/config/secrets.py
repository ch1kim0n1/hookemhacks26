"""Secrets management abstraction.

Sources:
- ``env``  — read from the process environment (default; local dev).
- ``aws``  — read from AWS Secrets Manager with a small TTL cache. Falls back
  to the process environment when a secret is not present in Secrets Manager,
  so you can mix real AWS-managed secrets with local overrides.
- ``vault`` — reserved. Not implemented.

The ``aws`` backend is intentionally thin: a 5-minute in-memory TTL cache so we
don't stampede the Secrets Manager API on every request, plus a name mapping
from the environment-variable-style key the codebase uses
(``CLAWGUARD_ADMIN_TOKEN``) to the ``<prefix>/<short-name>`` naming the
Terraform ``secrets`` module creates (``clawguard/admin-token``).

Rotation: the rotation Lambda swaps ``AWSCURRENT`` every 30 days. Consumers
that hold a cached value for up to ~5 minutes after a rotation will see the
stale value, then refresh. That is acceptable — rotation is a bearer-token
refresh, not a revocation.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

SUPPORTED_SOURCES = ("env", "aws", "vault")

# Env-var name → Secrets Manager short-name (after the prefix).
# Extend this as new managed secrets are added in the Terraform ``secrets`` module.
_AWS_SECRET_NAME_MAP: dict[str, str] = {
    "CLAWGUARD_ADMIN_TOKEN": "admin-token",
    "CLAWGUARD_METRICS_TOKEN": "metrics-token",
    "CLAWGUARD_WS_TOKEN": "ws-token",
}

_DEFAULT_CACHE_TTL_SECONDS = 300


class SecretsManager:
    """Read secrets from the configured source."""

    def __init__(
        self,
        source: str = "env",
        *,
        aws_prefix: str | None = None,
        aws_region: str | None = None,
        aws_client: Any | None = None,
        cache_ttl_seconds: int = _DEFAULT_CACHE_TTL_SECONDS,
    ) -> None:
        if source not in SUPPORTED_SOURCES:
            raise ValueError(
                f"Unsupported secrets source: {source}. Supported: {', '.join(SUPPORTED_SOURCES)}"
            )
        self.source = source
        self._aws_prefix = aws_prefix or os.environ.get("CLAWGUARD_SECRETS_PREFIX", "clawguard")
        self._aws_region = aws_region or os.environ.get("AWS_REGION", "us-east-1")
        self._aws_client = aws_client
        self._cache_ttl = cache_ttl_seconds
        self._cache: dict[str, tuple[float, str]] = {}
        self._cache_lock = threading.Lock()
        logger.info("SecretsManager initialized with source: %s", source)

    def get(self, key: str, default: str | None = None) -> str:
        if self.source == "env":
            return self._get_from_env(key, default)
        if self.source == "aws":
            return self._get_from_aws(key, default)
        if self.source == "vault":
            return self._get_from_vault(key, default)
        raise RuntimeError(f"Unsupported source: {self.source}")

    # ------------------------------------------------------------------
    # env
    # ------------------------------------------------------------------

    def _get_from_env(self, key: str, default: str | None) -> str:
        value = os.environ.get(key, default)
        if value is None:
            raise ValueError(
                f"Required secret not found: {key}. Set environment variable: export {key}=<value>"
            )
        if not value:
            logger.warning("Secret %s is empty (empty string)", key)
        return value

    # ------------------------------------------------------------------
    # aws
    # ------------------------------------------------------------------

    @property
    def aws_client(self) -> Any:
        if self._aws_client is None:
            import boto3

            self._aws_client = boto3.client("secretsmanager", region_name=self._aws_region)
        return self._aws_client

    def _resolve_aws_secret_id(self, key: str) -> str:
        short = _AWS_SECRET_NAME_MAP.get(key, key.lower().replace("_", "-"))
        return f"{self._aws_prefix}/{short}"

    def _get_from_aws(self, key: str, default: str | None) -> str:
        cached = self._cache_get(key)
        if cached is not None:
            return cached

        secret_id = self._resolve_aws_secret_id(key)
        try:
            response = self.aws_client.get_secret_value(SecretId=secret_id)
        except Exception as exc:  # boto will raise ClientError here in prod
            logger.warning(
                "AWS Secrets Manager lookup failed for %s (id=%s): %s — falling back to env",
                key,
                secret_id,
                exc,
            )
            return self._get_from_env(key, default)

        value = response.get("SecretString")
        if value is None:
            binary = response.get("SecretBinary")
            if binary is None:
                logger.warning("Secret %s has no SecretString or SecretBinary", secret_id)
                return self._get_from_env(key, default)
            value = binary.decode("utf-8") if isinstance(binary, (bytes, bytearray)) else str(binary)

        self._cache_put(key, value)
        return value

    def _cache_get(self, key: str) -> str | None:
        with self._cache_lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if expires_at < time.time():
                self._cache.pop(key, None)
                return None
            return value

    def _cache_put(self, key: str, value: str) -> None:
        with self._cache_lock:
            self._cache[key] = (time.time() + self._cache_ttl, value)

    def invalidate_cache(self, key: str | None = None) -> None:
        with self._cache_lock:
            if key is None:
                self._cache.clear()
            else:
                self._cache.pop(key, None)

    # ------------------------------------------------------------------
    # vault (reserved)
    # ------------------------------------------------------------------

    def _get_from_vault(self, _key: str, _default: str | None) -> str:
        raise NotImplementedError(
            "Vault support is not yet implemented. Use source='env' or source='aws'."
        )


_secrets_manager: SecretsManager | None = None


def init_secrets(source: str | None = None, **kwargs: Any) -> SecretsManager:
    """Initialise the process-wide secrets manager.

    ``source`` defaults to the ``CLAWGUARD_SECRETS_SOURCE`` env var, or ``env``.
    """
    global _secrets_manager
    resolved = source or os.environ.get("CLAWGUARD_SECRETS_SOURCE", "env")
    _secrets_manager = SecretsManager(resolved, **kwargs)
    return _secrets_manager


def get_secret(key: str, default: str | None = None) -> str:
    global _secrets_manager
    if _secrets_manager is None:
        logger.debug("Secrets manager not initialized; using default source")
        init_secrets()
    assert _secrets_manager is not None
    return _secrets_manager.get(key, default)


def get_secrets_manager() -> SecretsManager:
    global _secrets_manager
    if _secrets_manager is None:
        init_secrets()
    assert _secrets_manager is not None
    return _secrets_manager


def reset_secrets_manager() -> None:
    """Test helper — drop the process-wide instance so the next ``get_secret`` rebuilds."""
    global _secrets_manager
    _secrets_manager = None
