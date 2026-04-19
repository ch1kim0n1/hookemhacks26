# Base Sepolia deployment and verification

## Expected network

| Property | Value |
|----------|--------|
| Network | Base Sepolia |
| Chain ID | `84532` |
| Public RPC | `https://sepolia.base.org` (or Alchemy/Infura) |

## Contracts (Phase 1 stack)

Deploy and record addresses in `.env` (see `.env.example`):

1. **ClawGuardRegistry** — threat feed (`publishAttack`, `getRecentAttacks`, …)
2. **DefenseProtocol** — policy / defense updates (wire `MockGroth16Verifier` or real verifier for tests)
3. **ConsensusVoting** — quorum bundles (requires `ModelRegistry` setup)
4. **PauseController** — governance pause
5. **VictimLendingPool** — demo lending / oracle surface

Use Foundry with `CLAWGUARD_PRIVATE_KEY` funded on Base Sepolia:

```bash
cd contracts
forge build
# Deploy registry (example — extend script for full stack):
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
```

After deployment, paste addresses into `.env` and run:

```bash
python scripts/verify_base_sepolia.py
```

The script checks that each configured address returns non-empty bytecode on-chain.

### Extracting addresses from a broadcast

If you used `forge script ... --broadcast`, generate both the addresses JSON
and a ready-to-paste `.env` fragment in one step:

```bash
python scripts/extract_addresses.py \
    contracts/broadcast/DeployAll.s.sol/84532/run-latest.json \
    > config/addresses.base-sepolia.json
# stdout: addresses JSON (write to a file)
# stderr: `.env` fragment (paste into .env)
```

Then point the runtime at the JSON:

```bash
export ADDRESSES_FILE=config/addresses.base-sepolia.json
```

## End-to-end checks (manual)

With keys and addresses set:

1. `publishAttack` → read back via `getRecentAttacks` / `isKnownAttack`
2. `publishDefenseUpdate` on `DefenseProtocol` with mock verifier (see `contracts/test/MockGroth16DefenseProtocol.t.sol`)
3. Mempool / flash flows depend on `VictimLendingPool` deployment and oracle mocks — exercise in Foundry first (`forge test`)

## CI

Local `forge test` covers contract logic; **live** Sepolia verification is operator-run via `scripts/verify_base_sepolia.py` after deploy.
