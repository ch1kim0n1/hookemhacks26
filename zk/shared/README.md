# `sentinel-zk-shared` — guest ⇄ host shared types

`no_std` crate holding the single source of truth for every type that crosses the zkVM boundary, plus the three journal-layout helpers.

If you change anything here, all three guest image IDs change. Follow the checklist in [../VERIFIER_KEYS.md](../VERIFIER_KEYS.md).

## What's inside

| Symbol | Purpose |
|---|---|
| `GuestInputs`, `Action`, `Evidence`, `Policy`, `PolicyRule` | PolicyCompliance inputs |
| `CounterfactualInputs`, `CounterfactualDelta` | CounterfactualCorrectness inputs |
| `LearningInputs`, `LearningGeneration` | LearningLoopCorrectness inputs |
| `POLICY_JOURNAL_LEN` / `policy_journal()` | 96-byte layout |
| `COUNTERFACTUAL_JOURNAL_LEN` / `counterfactual_journal()` | 160-byte layout |
| `LEARNING_JOURNAL_LEN` / `learning_journal()` | 128-byte layout |

## `no_std`

Guests run with `std` stubbed. This crate uses `alloc` for `String` and `Vec` only. Any new dependency must also be `no_std`-compatible (or gated behind a feature off by default).

## Journal layout invariants

Every journal is right-padded 32-byte slots so the on-chain wrapper can reconstruct bytes with `abi.encodePacked(bytes32, bytes32, ...)` and hash via `sha256(journal)`.

Specifics:

- **Addresses** are left-padded into their 32-byte slot (12 leading zeros, then 20 bytes of address). Confirmed by `counterfactual_address_padding_never_collides`.
- **`uint256` fields like `winRateBp`, `generationCount`** are big-endian with leading zeros, matching Solidity ABI. Confirmed by `learning_journal_layout_matches_abi`.
- **Signed `delta_wei_be`** is two's-complement big-endian.

## Tests

[src/lib.rs](src/lib.rs) ships with ~10 unit tests covering every layout, every padding case, win-rate and generation-count bounds, and serde round-trips. They run on the host (not in the guest) and are exercised by the main CI `zk` job.

Notable cases:
- `counterfactual_zero_fork_hash_ok` — Approach B back-compat path.
- `counterfactual_inputs_default_fork_block_hash` — legacy JSON without the new field still deserialises.
- `policy_journal_slots_are_independent` — flipping any one slot only touches its own window.
