#!/usr/bin/env bash
# Run pytest for all Poetry-based Python services (detection-engine, defense-agent).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/services/detection-engine"
poetry install -q
poetry run pytest -q
cd "$ROOT/services/defense-agent"
poetry install -q
poetry run pytest -q
