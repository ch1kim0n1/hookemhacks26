# ClawGuard registry (Base Sepolia)

The legacy **ThreatRegistry** track from the Phase 1 issue is implemented as **`ClawGuardRegistry`** (`src/ClawGuardRegistry.sol`): publish hashed attack patterns, paginate with `getAttacksSince(fromIndex)`, and query `isKnownAttack` / `isThreat` for integrations such as `SentinelGuard`.

## Deploy

1. Copy repo root `.env.example` to `.env` and set:
   - `BASE_SEPOLIA_RPC_URL`
   - `CLAWGUARD_PRIVATE_KEY` (deployer)
   - Optional: `BASESCAN_API_KEY` for verification
2. From `contracts/`:

```bash
source ../.env
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast \
  -vvv
```

3. Record the logged address in `.env` as `CLAWGUARD_REGISTRY_ADDRESS` for the Python skill / API.

## Verify on Basescan (optional)

```bash
forge verify-contract <ADDRESS> ClawGuardRegistry \
  --chain base-sepolia \
  --etherscan-api-key "$BASESCAN_API_KEY"
```

## VictimLendingPool (`src/VictimLendingPool.sol`)

Demo **USDC/WETH** pool using a **spot oracle** (`MockOraclePair`) with no TWAP — intentionally exploitable for Scenario A. Wrapped by `SentinelGuard` (`sentinelProtected`). Tests: `contracts/test/VictimLendingPool.t.sol`.

## PauseController (`src/PauseController.sol`)

Emergency pause: only the configured **policy registry** address (your deployed `DefenseProtocol`) may `activate`; **governance** (deployer) may `deactivate`. Pair with `DEFENSE_PROTOCOL_ADDRESS` and `PAUSE_CONTROLLER_ADDRESS` in `.env`.

## DefenseProtocol (`src/DefenseProtocol.sol`)

Defense policy and **defense updates** (`publishDefenseUpdate` / `updatePolicy`) with ZK verifier hooks. Deploy with two verifier addresses (policy + learning); record `DEFENSE_PROTOCOL_ADDRESS` in `.env` when wired to the app.

Quorum validation is implemented by **`ConsensusVoting`** (`src/ConsensusVoting.sol`): configurable **K-of-N** thresholds, **`slash`** for malicious operators, and `submitBundle` / `isAccepted`. See `contracts/test/ConsensusVoting.t.sol`.

## Integration / verification

- **Local / CI:** run `forge test` in `contracts/` (covers `publishAttack` / `isKnownAttack`, `publishDefenseUpdate`, quorum, pause, victim pool, and `Phase1Integration.t.sol` smoke).
- **Base Sepolia:** deploy with `forge script` using `.env`, then record addresses in `.env` / `.env.example` placeholders. On-chain verification uses `BASESCAN_API_KEY` as in the registry section above.

## x402 bounty integration

HTTP 402 “payment required” flows are **not** wired on-chain; there is **no** on-chain x402 test in this repo. Bounty or micropayment hooks belong in the API / coordinator layer.
