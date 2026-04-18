#!/usr/bin/env bash
# Seed demo state: mint tokens, fund attacker + pool + oracle, warm up oracle.
# Assumes Anvil is running on :8545 and contracts are deployed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"

RPC=${RPC_URL:-http://127.0.0.1:8545}

# Anvil default accounts from the `junk` mnemonic.
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
# Anvil account #5 (attacker / demo trigger)
ATTACKER_KEY=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba
ATTACKER=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
# Anvil account #7 (LP that funds the victim pool)
LP_KEY=0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356
LP=0x14dC79964da2C08b23698B3D3cc7Ca32193d9955

A=$(jq -r . <"$REPO_ROOT/config/addresses.local.json")
get() { jq -r ".$1" <<<"$A"; }

USDC=$(get USDC)
WETH=$(get WETH)
ORACLE_PAIR=$(get OraclePair)
FLP=$(get FlashLoanProvider)
VICTIM=$(get VictimLendingPool)
ATTACKER_C=$(get FlashLoanAttacker)

echo "=== seed-demo-state ==="
echo "USDC:                $USDC"
echo "WETH:                $WETH"
echo "OraclePair:          $ORACLE_PAIR"
echo "FlashLoanProvider:   $FLP"
echo "VictimLendingPool:   $VICTIM"
echo "FlashLoanAttacker:   $ATTACKER_C"

# Helper: call MockERC20.mint(to, amount)
mint() {
    local token=$1 to=$2 amount=$3
    cast send --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" \
        "$token" "mint(address,uint256)" "$to" "$amount" >/dev/null
}

# 1. Seed oracle pair: 10k USDC + 1k WETH. Deployer mints + approves + seeds.
echo "Seeding oracle pair…"
mint "$USDC" "$DEPLOYER" 10000000000        # 10k USDC (6 decimals)
mint "$WETH" "$DEPLOYER" 1000000000000000000000 # 1k WETH (18 decimals)
cast send --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" \
    "$USDC" "approve(address,uint256)" "$ORACLE_PAIR" 10000000000 >/dev/null
cast send --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" \
    "$WETH" "approve(address,uint256)" "$ORACLE_PAIR" 1000000000000000000000 >/dev/null
# Check if already seeded.
seeded=$(cast call --rpc-url "$RPC" "$ORACLE_PAIR" "reserve0()(uint256)")
if [ "$seeded" = "0" ]; then
    cast send --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" \
        "$ORACLE_PAIR" "seed(uint256,uint256)" 10000000000 1000000000000000000000 >/dev/null
    echo "  oracle seeded: 10k USDC + 1k WETH"
else
    echo "  oracle already seeded"
fi

# 2. Fund flash-loan provider with 5k WETH.
echo "Funding flash-loan provider…"
mint "$WETH" "$FLP" 5000000000000000000000

# 3. Fund victim pool with 10k WETH borrowable liquidity via LP.
echo "Funding victim pool with 10k WETH liquidity via LP…"
mint "$WETH" "$LP" 10000000000000000000000
cast send --rpc-url "$RPC" --private-key "$LP_KEY" \
    "$WETH" "approve(address,uint256)" "$VICTIM" 10000000000000000000000 >/dev/null
# Only fund if pool is empty.
pool_weth=$(cast call --rpc-url "$RPC" "$WETH" "balanceOf(address)(uint256)" "$VICTIM")
if [ "$pool_weth" = "0" ]; then
    cast send --rpc-url "$RPC" --private-key "$LP_KEY" \
        "$VICTIM" "fundLiquidity(uint256)" 10000000000000000000000 >/dev/null
    echo "  victim pool funded"
else
    echo "  victim pool already funded ($pool_weth wei)"
fi

# 4. Attacker doesn't hold any USDC/WETH — they flash-loan WETH at attack time.
#    We just ensure the attacker EOA has gas.
bal=$(cast balance --rpc-url "$RPC" "$ATTACKER")
echo "Attacker EOA balance: $bal wei"

echo ""
echo "✅ seed-demo-state complete."
echo "   Trigger attack: curl -X POST http://localhost:8080/api/v1/demo/replay-scenario"
