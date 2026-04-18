# `counterfactual-correctness` — CounterfactualCorrectness guest

Proves: **the committed counterfactual-simulation result is internally consistent** — the sum of per-address balance deltas equals the claimed aggregate `deltaWei`, and the `counterfactualRoot` commits to that exact delta set under a SHA-256 Merkle tree.

This is the Hybrid Approach A/B circuit described in `absolute-docs/04_zk_proof_system.md §CounterfactualCorrectness`.

## Statement

Given private inputs
- `event_id`, `victim_protocol`
- `deltas: Vec<{ key, delta_wei_be }>` — per-leaf signed balance delta, two's-complement big-endian
- `claimed_delta_wei_be` — the aggregate delta being asserted
- `fork_block_hash` — 32 bytes; zero means Approach B structural proof, non-zero means Approach A pinning

the guest asserts, then commits:

1. `deltas` is non-empty.
2. `Σ delta_wei_be == claimed_delta_wei_be` (two's-complement 256-bit add).
3. `counterfactualRoot == merkle_root({ sha256(0x00 || key_i || delta_i) }_i)` with internal-node hash `sha256(0x01 || L || R)` and odd-fan-out duplicating the last leaf.
4. Writes `journal = counterfactual_journal(event_id, root, claimed_delta_wei_be, victim_protocol, fork_block_hash)`.

## Approach A vs B

| | Approach A (pinned) | Approach B (structural) |
|---|---|---|
| `fork_block_hash` | real block hash | all-zeros |
| Extra guarantee | journal commits to a provable EVM block | none beyond sum + root consistency |
| On-chain check | wrapper compares against `blockhash(N)` or a historical-blockhash oracle | ignores slot |
| Back-compat | opt-in via serde `default` | callers predating Hybrid A keep working |

Callers omitting `fork_block_hash` from the JSON keep working — `serde(default)` hands the guest all-zeros.

## Public inputs (journal)

`COUNTERFACTUAL_JOURNAL_LEN = 160`.

| Offset | Bytes | Field |
|---|---|---|
| 0 | 32 | `eventId` |
| 32 | 32 | `counterfactualRoot` |
| 64 | 32 | `deltaWei` (int256 two's-complement BE) |
| 96 | 32 | `victimProtocol` (20-byte address left-padded to bytes32) |
| 128 | 32 | `forkBlockHash` (zero iff Approach B) |

Layout constructed by `sentinel_zk_shared::counterfactual_journal`. Covered by unit tests in [../../shared/src/lib.rs](../../shared/src/lib.rs) (`counterfactual_journal_layout_matches_abi`, `counterfactual_address_padding_never_collides`).

## Not proven

- **Full EVM re-execution.** No `revm` inside the guest. "Simulation was run by X" is provided by the committee-of-simulators attestation on the `zk-prover` side, not by this circuit.
- **Policy compliance.** That's a separate circuit — do not expect `policyHash` in this journal.

## Sources

- Guest entry: [src/main.rs](src/main.rs)
- Input type + journal helper: [../../shared/src/lib.rs](../../shared/src/lib.rs)
- Host wrapper: [../../host/src/lib.rs](../../host/src/lib.rs) (`prove_counterfactual`)
- CLI: [../../host/src/bin/prove_counterfactual.rs](../../host/src/bin/prove_counterfactual.rs)
