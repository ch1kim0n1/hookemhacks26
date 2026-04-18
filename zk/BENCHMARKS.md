# ZK Benchmarks

Reference envelope for the three RISC Zero guests shipped in this workspace. Refresh whenever guest logic or RISC Zero versions change.

## Harness

- **Dev-mode:** `RISC0_DEV_MODE=1 cargo test -q` (CI `zk` job, every PR)
- **Full-Groth16:** `RISC0_DEV_MODE=0 cargo build --release --bins` then drive the relevant CLI from [services/zk-prover](../services/zk-prover/) (CI `zk-full` job — label `full-zk`, tag, or manual dispatch)
- **Local full-proof** requires a CUDA-capable GPU or Bonsai; CPU-only runs are 5-10× slower.

Measurement is wall-clock on the prover CLI (`elapsedMs` field of the output envelope). Re-measure on the target host — numbers below are the envelope we design against, not a contract.

## Proving time (Groth16, real proof)

| Circuit | Inputs | Journal | Local CUDA | Bonsai | Cache hit |
|---|---|---|---|---|---|
| PolicyCompliance | one action, one rule match, ~1 KB policy | 96 B | 15-30 s | 2-4 s | < 10 ms |
| CounterfactualCorrectness | 1-32 leaf deltas, one Merkle tree | 160 B | 5-10 s | 2-4 s | < 10 ms |
| LearningLoopCorrectness | ≤ 32 generations, u32 counts | 128 B | 5-15 s | 2-4 s | < 10 ms |

Dev-mode (`RISC0_DEV_MODE=1`) shortens every row to single-digit seconds — it skips the SNARK entirely and emits an `InnerReceipt::Fake`. Use only against `RiscZeroMockVerifier`.

## Seal size (on-chain calldata)

Groth16 seals are fixed-size regardless of circuit — `encode_seal` emits 260 bytes (4 B selector + 256 B proof). The seal is independent of journal length; calldata cost scales only with the journal you send alongside it.

| Circuit | Seal | Journal | Total calldata (bytes) |
|---|---|---|---|
| PolicyCompliance | 260 | 96 | 356 |
| CounterfactualCorrectness | 260 | 160 | 420 |
| LearningLoopCorrectness | 260 | 128 | 388 |

Under `RISC0_DEV_MODE=1` the seal is the 4-byte `0xFFFFFFFF` mock selector instead; calldata drops accordingly, but the mock verifier performs no crypto.

## On-chain verification gas (Groth16, single verify)

| Step | Approx gas | Source |
|---|---|---|
| `RiscZeroGroth16Verifier.verify` (pairing + journal digest) | ~260 k | `risc0-ethereum v3.0.1` |
| SENTINEL wrapper dispatch (`PolicyRegistry.verifyAndExecute` etc.) | +30-80 k | depends on action executed |
| Mock verifier (dev only) | ~10 k | constant-time, no-op |

`forge snapshot` in [../contracts/](../contracts/) is the canonical gas oracle — CI uploads `.gas-snapshot` as a build artifact.

## Memory and executor cycles

RISC Zero reports cycles per proof in stderr when `RUST_LOG=info`. Useful ranges on this codebase:

| Circuit | Cycles (approx) |
|---|---|
| PolicyCompliance | 1-4 M (dominates: `serde_json::from_str` on policy) |
| CounterfactualCorrectness | 1-3 M (scales linearly in `deltas.len()`) |
| LearningLoopCorrectness | 1-2 M (scales linearly in `generations.len()`) |

Cycle count sets the Bonsai bill and local proving time. Halving cycles roughly halves proving time; the biggest win for PolicyCompliance would be moving to a canonical binary policy encoding and dropping `serde_json`.

## Regenerating this table

1. In `zk/`: `RISC0_DEV_MODE=0 cargo build --release --bins`.
2. For each circuit, feed a representative input to the CLI three times; take the median `elapsedMs`.
3. In `contracts/`: `forge snapshot` and cite the relevant test.
4. Update this file in the same PR.

Keep the envelope honest — if a change makes a circuit 2× slower, land it with the number, not the comment.
