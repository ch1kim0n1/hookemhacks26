# Optional: deploy contracts to a public testnet

This is **not required** for the hackathon demo (Anvil + local stack is the default). Use this when you want a live explorer link for judges.

## Prerequisites

1. A funded deployer key on **Base Sepolia**, **Arbitrum Sepolia**, or **Sepolia** (pick one).
2. `forge` and `contracts/` dependencies installed.

## Steps

```bash
cd contracts
forge script script/DeployLocal.s.sol --rpc-url "$TESTNET_RPC_URL" --broadcast --verify
```

Replace with your project’s actual deploy script if different. Update `config/addresses.<network>.json` and set:

- `VITE_SENTINEL_API` — public gateway URL if any
- `VITE_EXPLORER_BASE` — e.g. `https://sepolia.basescan.org/address/`

Then rebuild the frontend so the QR / verify links point at the explorer.

## Security

Never commit private keys. Use `.env` (gitignored) and CI secrets only.
