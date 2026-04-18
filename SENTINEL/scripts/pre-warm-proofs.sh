#!/usr/bin/env bash
# Pre-warm the zk-prover cache (L1 in-memory + L2 Postgres) with every
# canonical demo scenario. Run once after `pnpm dev` shows "All services
# ready" so the live /demo pitch is a cache hit on all three circuits.
#
# Real Groth16 proofs take 30-60s each on local hardware; this script
# pays that cost up front so the demo loop stays sub-second.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROVER="${ZK_PROVER_URL:-http://localhost:9100}"
ADDR_FILE=config/addresses.local.json
VICTIM=$(jq -r .VictimLendingPool "$ADDR_FILE")
POLICY_JSON=$(jq -c . config/policy.json)

EVENT_ID_ZERO='[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'
VICTIM_BYTES="$(python3 -c "
import json, sys
a = '$VICTIM'.lower().removeprefix('0x')
print(json.dumps([int(a[i:i+2], 16) for i in range(0, len(a), 2)]))
")"

# --------------------------------------------------------------------
# Circuit 1/3: policy-compliance — Scenario A canonical evidence.
# --------------------------------------------------------------------
echo "[1/3] warming /prove/policy (flash-loan scenario)..."
POLICY_PAYLOAD=$(jq -n \
    --arg policy "$POLICY_JSON" \
    --argjson victim "$VICTIM_BYTES" \
    --argjson eventId "$EVENT_ID_ZERO" \
    '{
        policy_json: $policy,
        action: {
            target: $victim,
            selector: [233, 46, 204, 243],
            calldata: []
        },
        evidence: {
            event_id: $eventId,
            pattern: "FLASH_LOAN_ORACLE_MANIP",
            confidence: 9300,
            victim_protocol: $victim,
            features: [9300, 8370, 8835, 7440, 200]
        }
    }')
curl -sSf -X POST "$PROVER/prove/policy" \
    -H 'content-type: application/json' \
    -d "$POLICY_PAYLOAD" | jq '{circuit, elapsedMs, cached}'

# --------------------------------------------------------------------
# Circuit 2/3: counterfactual-correctness — demo's prevented-loss claim.
# --------------------------------------------------------------------
echo "[2/3] warming /prove/counterfactual (prevented-loss claim)..."
# Leaf key = sha256("victim.wethReserve").
LEAF_KEY=$(printf '%s' 'victim.wethReserve' | openssl dgst -sha256 | awk '{print $NF}')
LEAF_KEY_BYTES=$(python3 -c "
h = '$LEAF_KEY'
print('[' + ','.join(str(int(h[i:i+2], 16)) for i in range(0, 64, 2)) + ']')
")
# Claimed prevented loss: 4e18 wei (~4 WETH; matches demo config).
DELTA_BE=$(python3 -c "
v = 4 * 10**18
b = v.to_bytes(32, 'big')
print('[' + ','.join(str(x) for x in b) + ']')
")
COUNTERFACTUAL_PAYLOAD=$(jq -n \
    --argjson eventId "$EVENT_ID_ZERO" \
    --argjson victim "$VICTIM_BYTES" \
    --argjson key "$LEAF_KEY_BYTES" \
    --argjson deltaBe "$DELTA_BE" \
    '{
        event_id: $eventId,
        victim_protocol: $victim,
        deltas: [{ key: $key, delta_wei_be: $deltaBe }],
        claimed_delta_wei_be: $deltaBe
    }')
curl -sSf -X POST "$PROVER/prove/counterfactual" \
    -H 'content-type: application/json' \
    -d "$COUNTERFACTUAL_PAYLOAD" | jq '{circuit, elapsedMs, cached}'

# --------------------------------------------------------------------
# Circuit 3/3: learning-correctness — scripted policy update story.
# --------------------------------------------------------------------
echo "[3/3] warming /prove/learning (policy v2 earned via co-evolution)..."
OLD_HASH=$(python3 -c "
import hashlib
print('[' + ','.join(str(b) for b in hashlib.sha256(b'policy-v1').digest()) + ']')
")
NEW_HASH=$(python3 -c "
import hashlib
print('[' + ','.join(str(b) for b in hashlib.sha256(b'policy-v2').digest()) + ']')
")
BATCH_ROOT=$(python3 -c "
import hashlib
print('[' + ','.join(str(b) for b in hashlib.sha256(b'training-batch-42').digest()) + ']')
")
LEARNING_PAYLOAD=$(jq -n \
    --argjson oldHash "$OLD_HASH" \
    --argjson newHash "$NEW_HASH" \
    --argjson batch "$BATCH_ROOT" \
    '{
        old_policy_hash: $oldHash,
        new_policy_hash: $newHash,
        min_win_rate_bp: 8000,
        min_generations: 10,
        event_batch_root: $batch,
        generations: [
            { attack_count: 100, defended_count: 92 },
            { attack_count: 100, defended_count: 94 },
            { attack_count: 100, defended_count: 95 },
            { attack_count: 100, defended_count: 96 },
            { attack_count: 100, defended_count: 96 },
            { attack_count: 100, defended_count: 97 },
            { attack_count: 100, defended_count: 97 },
            { attack_count: 100, defended_count: 98 },
            { attack_count: 100, defended_count: 98 },
            { attack_count: 100, defended_count: 99 }
        ]
    }')
curl -sSf -X POST "$PROVER/prove/learning" \
    -H 'content-type: application/json' \
    -d "$LEARNING_PAYLOAD" | jq '{circuit, elapsedMs, cached}'

echo ""
echo "✅ prover cache warmed for all 3 circuits"
