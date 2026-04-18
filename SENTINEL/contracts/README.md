# `contracts/` — Foundry Solidity

The on-chain half of SENTINEL. Every defense action, every counterfactual commit, every cross-protocol signature lands here.

## Contracts

### Core

| Contract | Role |
|---|---|
| [PolicyRegistry.sol](src/PolicyRegistry.sol) | Holds the current `policyHash`. `verifyAndExecute(seal, imageId, journalDigest, action)` is the only authorised mutator: reverts unless the `PolicyCompliance` Groth16 proof verifies against this hash. |
| [CounterfactualLedger.sol](src/CounterfactualLedger.sol) | Append-only ledger of `CounterfactualCorrectness` commitments. Each record binds `(eventId, counterfactualRoot, deltaWei, victimProtocol, forkBlockHash)` to a verified proof. |
| [ThreatRegistry.sol](src/ThreatRegistry.sol) | On-chain attack-signature registry. `preemptive-strike` publishes here; peers read to seed their mempool matchers. |
| [PauseController.sol](src/PauseController.sol) | Protocol-neutral pause surface. `defense-agent` and `preemptive-strike` call `pause(target)`. |
| [SentinelGuard.sol](src/SentinelGuard.sol) | Wrapper that target protocols compose to gate sensitive entry-points behind PauseController + PolicyRegistry. |
| [ModelRegistry.sol](src/ModelRegistry.sol) | Records every operator's `modelHash`; `OperatorVerdict@1.modelHash` must resolve here. |
| [FederationVerifier.sol](src/FederationVerifier.sol) | K-of-N check for attested threat events bundled into a single on-chain commit. |
| [QuarantineVault.sol](src/QuarantineVault.sol) | Holds recovered funds pending release. |
| [VictimLendingPool.sol](src/VictimLendingPool.sol) | Reference protected protocol used by the demo. |

### Auxiliary

- [src/demo/](src/demo/) — attacker contracts (FlashLoanAttacker, FlashLoanProvider) and protocol harnesses used only by the demo flow.
- [src/mocks/](src/mocks/) — test-only mocks (ERC20, oracles, etc.).
- [src/verifiers/](src/verifiers/) — wrappers around the RISC Zero Groth16 verifier for each circuit.

## Tests

`forge test -v` covers all four layers:

| Layer | Path |
|---|---|
| Unit | [test/unit/](test/unit/) |
| Integration | [test/integration/](test/integration/) — full defense lifecycle, flash-loan defense |
| Fuzz | [test/fuzz/](test/fuzz/) — three campaigns with the `ci` Foundry profile (high fuzz budget) |
| Helpers | [test/helpers/](test/helpers/) |

CI uploads a `forge snapshot` gas report as an artifact — use `forge snapshot --diff` locally to spot regressions. The `zk-full` CI job additionally exercises real Groth16 end-to-end against `RiscZeroGroth16Verifier`.

## Deployment

```bash
forge script contracts/script/DeployLocal.s.sol \
  --rpc-url $RPC_URL --broadcast
```

Writes addresses to [../config/addresses.local.json](../config/addresses.local.json); `api-gateway` probes them on startup via `eth_getCode`.

Image IDs for the ZK verifier wrappers come from [../config/zk-image-ids.json](../config/zk-image-ids.json). Rotate those whenever a guest crate changes — see [../zk/VERIFIER_KEYS.md](../zk/VERIFIER_KEYS.md).

## Dependencies

Installed under `lib/` by the CI install step (not committed):

- [forge-std v1.7.6](https://github.com/foundry-rs/forge-std)
- [OpenZeppelin v5.0.2](https://github.com/OpenZeppelin/openzeppelin-contracts)
- [risc0-ethereum v3.0.1](https://github.com/risc0/risc0-ethereum)

## Invariants

Producers writing new contracts must preserve:

1. **No authority outside `verifyAndExecute`.** Every state-changing call from off-chain enters through a proof-gated path.
2. **Image IDs come from config.** Never hard-code a `bytes32` image ID in source; pull it from the deploy script's `vm.readFile`.
3. **Pause reversibility.** `PauseController.pause` must be paired with `unpause` — no stuck state after a false positive.
4. **Event shapes match [../schemas/](../schemas/).** If you emit a new Solidity event whose JSON form hits the Redis bus, add a schema + fixtures pair.
