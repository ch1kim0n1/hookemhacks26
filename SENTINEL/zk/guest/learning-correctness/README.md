# `learning-correctness` — LearningLoopCorrectness guest

Proves: **the new policy was earned by adversarial co-evolution** — across ≥ `min_generations` rounds, the candidate policy defended committed attacks at aggregate win-rate ≥ `min_win_rate_bp`.

## Statement

Given private inputs
- `old_policy_hash`, `new_policy_hash` — 32 bytes each
- `min_win_rate_bp: u16` (basis points, 0-10000)
- `min_generations: u32`
- `event_batch_root: [u8; 32]` — Merkle root of the committed eval batch (private binding)
- `generations: Vec<{ attack_count, defended_count }>`

the guest asserts, then commits:

1. `old_policy_hash != new_policy_hash` (the policy actually moved).
2. `generations.len() >= min_generations`.
3. For every generation, `defended_count <= attack_count`.
4. `Σ attack_count > 0`.
5. `win_rate_bp := (Σ defended * 10_000) / Σ attacks`, as `u16`.
6. `win_rate_bp >= min_win_rate_bp`.
7. Writes `journal = learning_journal(old_policy_hash, new_policy_hash, win_rate_bp, gen_count)`.

## Public inputs (journal)

`LEARNING_JOURNAL_LEN = 128`.

| Offset | Bytes | Field |
|---|---|---|
| 0 | 32 | `oldPolicyHash` |
| 32 | 32 | `newPolicyHash` |
| 64 | 32 | `winRateBp` (uint256 BE; top 30 bytes zero) |
| 96 | 32 | `generationCount` (uint256 BE; top 28 bytes zero) |

Layout constructed by `sentinel_zk_shared::learning_journal`. Bounds exercised by `learning_journal_win_rate_bounds` and `learning_journal_generation_count_fits_uint32_max` in [../../shared/src/lib.rs](../../shared/src/lib.rs).

## `event_batch_root` is private

Kept off the journal on purpose — keeps public-input bytes compact on-chain. The on-chain consumer binds to the batch by wrapping this proof inside a parent commitment that re-publishes the root, or by recomputing it from off-chain evidence before calling `verify`.

## Integration

- Called by [services/learning-loop](../../../services/learning-loop/) at the end of each generation when `ZK_PROVER_URL` is set.
- A pre-warmed cached proof backs the demo flow ([scripts/pre-warm-proofs.sh](../../../scripts/pre-warm-proofs.sh)).

## Sources

- Guest entry: [src/main.rs](src/main.rs)
- Input type + journal helper: [../../shared/src/lib.rs](../../shared/src/lib.rs)
- Host wrapper: [../../host/src/lib.rs](../../host/src/lib.rs) (`prove_learning`)
- CLI: [../../host/src/bin/prove_learning.rs](../../host/src/bin/prove_learning.rs)
