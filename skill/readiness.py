"""One-command demo readiness checks (issue #112)."""

from __future__ import annotations

import importlib.util
import json
import sys

from skill import db
from skill.contracts_config import addresses_path, deployment_profile, threat_registry_address
from skill.latency_budgets import API_SCAN_P95_MS, HOOK_INTERCEPT_MS


def run_checks() -> tuple[bool, dict]:
    """Return (all_ok, report)."""
    report: dict = {"checks": [], "deploy_profile": deployment_profile()}
    ok = True

    def add(name: str, passed: bool, detail: str) -> None:
        nonlocal ok
        if not passed:
            ok = False
        report["checks"].append({"name": name, "ok": passed, "detail": detail})

    integrity_ok, integrity_msg = db.sqlite_quick_check()
    add("sqlite_integrity", integrity_ok, integrity_msg)

    head, current = db.alembic_revision_pair()
    mig_ok = bool(head and current == head)
    add("migrations_at_head", mig_ok, f"head={head} current={current}")

    addr_file = addresses_path()
    add("addresses_file_exists", addr_file.is_file(), str(addr_file))

    reg = threat_registry_address()
    add("registry_address_configured", bool(reg), reg or "set CLAWGUARD_REGISTRY_ADDRESS or ThreatRegistry in addresses file")

    spec = importlib.util.find_spec("detector.classifier")
    add(
        "classifier_module_import",
        spec is not None,
        "optional ML stack present" if spec else "detector.classifier not importable",
    )

    report["latency_budgets_ms"] = {
        "hook_intercept": HOOK_INTERCEPT_MS,
        "api_scan_p95_target": API_SCAN_P95_MS,
    }
    return ok, report


def main() -> None:
    good, rep = run_checks()
    print(json.dumps(rep, indent=2))
    sys.exit(0 if good else 2)


if __name__ == "__main__":
    main()
