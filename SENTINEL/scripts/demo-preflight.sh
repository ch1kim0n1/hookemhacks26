#!/usr/bin/env bash
# Demo pre-flight check: validates everything is ready before the demo starts.
# Run time target: < 5 seconds
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
PASS=0
FAIL=0

check() {
    local name="$1"
    local result="$2"
    if [ "$result" = "ok" ]; then
        echo "  ✅ $name"
        PASS=$((PASS+1))
    else
        echo "  ❌ $name — $result"
        FAIL=$((FAIL+1))
    fi
}

echo "=== SENTINEL Demo Pre-flight ==="
echo ""

# 1. Anvil running + contracts deployed
echo "Infrastructure:"
if cast rpc eth_blockNumber --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; then
    check "Anvil running" "ok"
else
    check "Anvil running" "not responding on port 8545"
fi

ADDR_FILE="$REPO_ROOT/config/addresses.local.json"
if [ -f "$ADDR_FILE" ] && jq -e .PolicyRegistry "$ADDR_FILE" >/dev/null 2>&1; then
    check "Contracts deployed" "ok"
else
    check "Contracts deployed" "addresses.local.json missing or incomplete — run bootstrap.sh"
fi

# 2. Redis running + streams empty
if redis-cli -p 6379 ping >/dev/null 2>&1; then
    check "Redis running" "ok"
else
    check "Redis running" "not responding on port 6379"
fi

# 3. Services health checks
echo ""
echo "Services:"
for svc_port in "api-gateway:8080:/api/v1/health" "mempool-monitor:9001:/health" "counterfactual-sim:9002:/health" "detection-engine:9003:/health" "defense-agent:9004:/health" "zk-prover:9100:/health"; do
    IFS=: read -r svc port path <<< "$svc_port"
    if curl -sf "http://127.0.0.1:$port$path" >/dev/null 2>&1; then
        check "$svc" "ok"
    else
        check "$svc" "not responding on port $port"
    fi
done

# 4. Frontend serving
echo ""
echo "Frontend:"
if curl -sf http://127.0.0.1:3000 >/dev/null 2>&1; then
    check "Frontend (port 3000)" "ok"
else
    check "Frontend (port 3000)" "not serving — run: pnpm --filter @sentinel/frontend dev"
fi

# 5. Proof cache pre-warmed
echo ""
echo "Proof system:"
CACHE_SIZE=$(curl -sf http://127.0.0.1:9100/health 2>/dev/null | jq -r '.cacheSize // 0' 2>/dev/null || echo "0")
if [ "$CACHE_SIZE" -gt 0 ]; then
    check "Proof cache ($CACHE_SIZE entries)" "ok"
else
    check "Proof cache" "empty — run: ./scripts/pre-warm-proofs.sh"
fi

# 6. Policy hash alignment
echo ""
echo "Policy:"
if [ -f "$ADDR_FILE" ]; then
    POLICY_REG=$(jq -r .PolicyRegistry "$ADDR_FILE" 2>/dev/null)
    if [ -n "$POLICY_REG" ] && [ "$POLICY_REG" != "null" ]; then
        CHAIN_HASH=$(cast call "$POLICY_REG" "currentPolicyHash()(bytes32)" --rpc-url http://127.0.0.1:8545 2>/dev/null | tr -d ' ')
        LOCAL_HASH="0x$(./scripts/compute-policy-hash.sh 2>/dev/null | tr -d ' ')"
        if [ -n "$CHAIN_HASH" ] && [ "$CHAIN_HASH" != "0x" ]; then
            check "Policy hash on-chain" "ok"
        else
            check "Policy hash" "could not read from chain"
        fi
    fi
fi

# Summary
echo ""
echo "===================="
echo "Passed: $PASS  Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
    echo "❌ NOT READY — fix the above failures before demo"
    exit 1
fi
echo "✅ ALL CHECKS PASSED — ready for demo!"
exit 0
