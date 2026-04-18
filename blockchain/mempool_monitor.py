"""Watch pending transactions for mempool-based signals (stub for Base Sepolia)."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def peek_pending(w3: Any, limit: int = 16) -> list[str]:
    """Return pending tx hashes when the RPC exposes them."""
    try:
        pend = w3.eth.get_block("pending")
        txs = pend.get("transactions", [])
        out = []
        for t in txs[:limit]:
            if isinstance(t, str):
                out.append(t)
            else:
                out.append(t.hex())
        return out
    except Exception as e:
        logger.debug("mempool peek failed: %s", e)
    return []
