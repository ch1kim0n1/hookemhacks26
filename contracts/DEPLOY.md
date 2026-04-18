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

## DefenseProtocol (`src/DefenseProtocol.sol`)

Defense policy and **defense updates** (`publishDefenseUpdate` / `updatePolicy`) with ZK verifier hooks. Deploy with two verifier addresses (policy + learning); record `DEFENSE_PROTOCOL_ADDRESS` in `.env` when wired to the app.

Quorum / federation validation is composed via **ConsensusVoting** (`FederationVerifier` in `ConsensusVoting.sol`); see `contracts/test/` for bundle acceptance tests in later phases.

## x402 bounty integration

HTTP 402 “payment required” flows are **not** wired on-chain in this registry. Bounty or micropayment hooks belong in the API / coordinator layer; track separately from contract deployment.
