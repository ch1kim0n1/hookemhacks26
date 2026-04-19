#!/usr/bin/env python3
"""Verify contract addresses file + env alignment (issue #106)."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]


def main() -> None:
    path = Path(os.getenv("CLAWGUARD_ADDRESSES_FILE", _REPO / "config" / "addresses.local.json"))
    if not path.is_file():
        print(f"FAIL: addresses file missing: {path}")
        sys.exit(2)
    data = json.loads(path.read_text(encoding="utf-8"))
    env_reg = os.getenv("CLAWGUARD_REGISTRY_ADDRESS", "").strip()
    file_reg = str(data.get("ThreatRegistry", "")).strip()
    effective = env_reg or file_reg
    if not effective:
        print("FAIL: ThreatRegistry not in file and CLAWGUARD_REGISTRY_ADDRESS unset")
        sys.exit(2)
    print(json.dumps({"ok": True, "registry": effective, "source": "env" if env_reg else "file"}, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
