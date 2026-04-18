#!/usr/bin/env bash
# Phase 2 smoke: generate a real PolicyCompliance proof locally and
# print its public inputs. Exercises the prove_policy binary end-to-end.
#
# Usage:
#   ./scripts/prove-policy.sh            # real proof (slow, 30-120s)
#   RISC0_DEV_MODE=1 ./scripts/prove-policy.sh   # dev mode (fast, no cryptographic proof)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO_ROOT/zk/target/release/prove_policy"

if [ ! -x "$BIN" ]; then
    echo "prove_policy not built. Run: cd zk && cargo build --release -p sentinel-zk-host"
    exit 1
fi

# Read the canonicalized policy JSON (whatever is in config/policy.json).
POLICY_JSON=$(cat "$REPO_ROOT/config/policy.json")

# Construct a matching GuestInputs fixture. We target the PauseController
# activate() selector against the VictimLendingPool (just uses placeholder
# bytes — the smoke test only checks the guest runs + proves + commits).
VICTIM=$(python3 -c "
import json
with open('$REPO_ROOT/config/addresses.local.json') as f:
    data = json.load(f)
v = data.get('VictimLendingPool', '0x' + '11' * 20)
# Output 20 bytes as a JSON array.
raw = bytes.fromhex(v.replace('0x',''))
print(list(raw))
" 2>/dev/null || echo "[17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17]")

cat > /tmp/guest-inputs.json <<EOF
{
  "policy_json": $(jq -Rs . <<< "$POLICY_JSON"),
  "action": {
    "target": $VICTIM,
    "selector": [233, 46, 204, 243],
    "calldata": [233, 46, 204, 243]
  },
  "evidence": {
    "event_id": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
    "pattern": "FLASH_LOAN_ORACLE_MANIP",
    "confidence": 9300,
    "victim_protocol": $VICTIM,
    "features": [9300, 8370, 8835, 7440, 200]
  }
}
EOF

echo "=== prove_policy smoke ==="
echo "Fixture: /tmp/guest-inputs.json"
echo "Running prover..."
start=$(date +%s)
"$BIN" < /tmp/guest-inputs.json > /tmp/policy-proof.json
end=$(date +%s)
elapsed=$((end - start))

echo "=== proof output (/tmp/policy-proof.json) ==="
jq '{proof: (.proof[0:40] + "..."), publicInputs, imageId, elapsedMs}' /tmp/policy-proof.json
echo "✅ proof generated (wall-clock ${elapsed}s)"
