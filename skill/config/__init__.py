"""ClawGuard configuration module."""

from skill.config.secrets import (
    SecretsManager,
    get_secret,
    get_secrets_manager,
    init_secrets,
)

__all__ = [
    "SecretsManager",
    "get_secret",
    "get_secrets_manager",
    "init_secrets",
]
