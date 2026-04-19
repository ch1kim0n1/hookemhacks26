"""Single source for default contract addresses (issues #100, #117)."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT_ADDRESSES = _REPO_ROOT / "config" / "addresses.local.json"


def addresses_path() -> Path:
    raw = os.getenv("CLAWGUARD_ADDRESSES_FILE", "").strip()
    return Path(raw) if raw else _DEFAULT_ADDRESSES


def load_contract_addresses() -> dict[str, str]:
    """Load deployment map. Missing file → empty dict (callers decide strictness)."""
    p = addresses_path()
    if not p.is_file():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return {str(k): str(v) for k, v in data.items()}
    except Exception as exc:
        logger.warning("contracts_config: failed to read %s: %s", p, exc)
        return {}


def threat_registry_address() -> str:
    """Prefer env, then addresses file ``ThreatRegistry`` key."""
    env = os.getenv("CLAWGUARD_REGISTRY_ADDRESS", "").strip()
    if env:
        return env
    data = load_contract_addresses()
    return data.get("ThreatRegistry", "").strip()


def deployment_profile() -> str:
    """``local`` | ``testnet`` | ``unset`` — for parity checks (issue #117)."""
    return os.getenv("CLAWGUARD_DEPLOY_PROFILE", "unset").strip().lower()
