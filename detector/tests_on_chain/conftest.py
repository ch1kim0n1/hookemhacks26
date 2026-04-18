"""Put the service root on sys.path so `bench.*` imports resolve in tests."""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent  # repo root (clawguard/)
_DETECTOR = _ROOT / "detector"
for p in (_ROOT, _DETECTOR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
