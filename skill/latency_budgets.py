"""Target latency budgets for user-facing paths (issue #111). Documentary constants."""

from __future__ import annotations

# Wall-clock hook timeout default (see hook_registrar).
HOOK_INTERCEPT_MS = 3_000

# API scan handler (excluding huge uploads).
API_SCAN_P95_MS = 5_000

# Chain publish (testnet) — informational only.
CHAIN_PUBLISH_P95_MS = 60_000
