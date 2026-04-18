"""Phase 1 on-chain coverage lives under `contracts/test/` (Foundry).

CI runs `forge test` in the contracts job; this file keeps a lightweight pytest
anchor so `tests/contracts/test_*.py` exists per the Phase 1 integration issue.
"""

from pathlib import Path


def test_phase1_forge_tests_present():
    root = Path(__file__).resolve().parents[2]
    test_dir = root / "contracts" / "test"
    sol_tests = list(test_dir.glob("*.t.sol"))
    assert len(sol_tests) >= 6, f"expected multiple .t.sol files under {test_dir}"
