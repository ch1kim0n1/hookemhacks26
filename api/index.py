"""Vercel serverless entrypoint.

Exposes the full :mod:`skill.api` FastAPI application under the Vercel Python
runtime (ASGI auto-detected). This gives us full feature parity with the
long-running server — same routes, same middleware, same detection pipeline —
instead of maintaining a second, dumbed-down HTTP handler.

Important Vercel-specific notes:

* SQLite lives in ``/tmp/clawguard.db`` (ephemeral). That's already handled by
  :mod:`skill.db_path`.
* Signal handlers / graceful-shutdown plumbing are skipped when the
  ``VERCEL`` env var is set (see :mod:`skill.api`).
* We set ``CLAWGUARD_DISABLE_SIGNAL_HANDLERS`` defensively for older envs.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

os.environ.setdefault("CLAWGUARD_DISABLE_SIGNAL_HANDLERS", "1")

# Import after sys.path + env setup so skill.api sees them.
from skill.api import app

# Vercel's Python runtime looks for an ASGI callable named ``app`` or
# ``handler``. Export both to be explicit.
handler = app

__all__ = ["app", "handler"]
