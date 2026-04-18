"""Submit a preemptive defense transaction (delegates to web3 account)."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def send_raw_transaction(w3: Any, signed_tx: bytes) -> str | None:
    """Broadcast raw signed tx bytes."""
    try:
        h = w3.eth.send_raw_transaction(signed_tx)
        return h.hex()
    except Exception as e:
        logger.warning("preemptive_strike send failed: %s", e)
        return None
