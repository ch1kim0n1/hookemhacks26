# `zk/` — SENTINEL Proving System

RISC Zero zkVM circuits and host wrappers that anchor SENTINEL v2's on-chain trust claims. Rust workspace.

Three circuits, one host, one shared crate, two CI lanes. Everything a reviewer, operator, or on-call engineer needs to know about the ZK surface lives in this directory.

## Map

| Path | Purpose |
|---|---|
| [Cargo.toml](Cargo.toml) | Workspace root (resolver 2) |
| [guest/policy-compliance/](guest/policy-compliance/) | Circuit 1 — action ⇔ policy binding |
| [guest/counterfactual-correctness/](guest/counterfactual-correctness/) | Circuit 2 — counterfactual loss delta |
| [guest/learning-correctness/](guest/learning-correctness/) | Circuit 3 — adversarial learning floor |
| [host/](host/) | Prover binaries + library wrappers |
| [shared/](shared/) | `no_std` types, journal layouts, unit tests |
| [BENCHMARKS.md](BENCHMARKS.md) | Proving time, seal size, verify gas |
| [VERIFIER_KEYS.md](VERIFIER_KEYS.md) | Image-ID pinning and distribution |

## Dependencies (pinned)

| Crate | Version | Notes |
|---|---|---|
| `risc0-zkvm` | `=3.0.5` | Workspace dep; default-features off on guests |
| `risc0-build` | `=3.0.5` | Host build-dep, embeds guest ELFs |
| `risc0-ethereum-contracts` | `=3.0.1` | `encode_seal` for Groth16 → Solidity bytes |
| RISC Zero toolchain | installed via `rzup` | CI and devs both use the same launcher |

## What each circuit commits

Journals are **raw bytes** committed via `env::commit_slice`. Every slot is 32 bytes, big-endian, right-padded — the on-chain wrapper rebuilds them with `abi.encodePacked(bytes32,...)` and hashes via `sha256(journal)` to obtain `journalDigest`. No risc0-specific serde on-chain.

### PolicyCompliance — 96-byte journal

```
actionHash || policyHash || eventId
```

Proves: the submitted action is authorised under the current policy for this threat event. Panic on mismatch = no proof = Agent Constraint Failure demo.

Details: [guest/policy-compliance/README.md](guest/policy-compliance/README.md).

### CounterfactualCorrectness — 160-byte journal

```
eventId || counterfactualRoot || deltaWei (int256 BE) || victimProtocol (left-pad) || forkBlockHash
```

Proves: the committed per-address delta set sums to the claimed `deltaWei`, its SHA-256 Merkle root matches `counterfactualRoot`, and (when `forkBlockHash != 0`) the proof is pinned to a real historical block. Approach A/B hybrid.

Details: [guest/counterfactual-correctness/README.md](guest/counterfactual-correctness/README.md).

### LearningLoopCorrectness — 128-byte journal

```
oldPolicyHash || newPolicyHash || winRateBp (uint256 BE) || generationCount (uint256 BE)
```

Proves: across ≥ `min_generations` rounds, the candidate policy defended aggregated attacks at ratio ≥ `min_win_rate_bp`. Policy hashes must differ.

Details: [guest/learning-correctness/README.md](guest/learning-correctness/README.md).

## Guest ↔ host wire contract

Guests take serde-encoded input via `env::read()`. Shapes live in [shared/src/lib.rs](shared/src/lib.rs) — they are the single source of truth for host ↔ guest encoding and for the journal-layout helpers.

| Circuit | Input type | Journal const | Bytes |
|---|---|---|---|
| Policy | `GuestInputs` | `POLICY_JOURNAL_LEN` | 96 |
| Counterfactual | `CounterfactualInputs` | `COUNTERFACTUAL_JOURNAL_LEN` | 160 |
| Learning | `LearningInputs` | `LEARNING_JOURNAL_LEN` | 128 |

## Host CLIs

All three CLIs read JSON from stdin and emit a single JSON object on stdout. Stderr carries human-readable progress. Called from [services/zk-prover](../services/zk-prover/).

```bash
# Build
cd zk && cargo build --release --bins

# Prove
echo '<CounterfactualInputs JSON>' | ./target/release/prove_counterfactual
echo '<GuestInputs JSON>'          | ./target/release/prove_policy
echo '<LearningInputs JSON>'       | ./target/release/prove_learning

# Dump image IDs (for on-chain verifier pinning)
./target/release/dump_image_ids [out_path]
```

Output envelope:

```json
{
  "proof":        "0x...",           // encode_seal(receipt) bytes
  "publicInputs": ["0x...", "..."],  // journal sliced into 32-byte chunks
  "imageId":      "0x...",           // bytes32, little-endian limbs
  "journal":      "0x...",           // raw journal bytes (hex)
  "elapsedMs":    12345,
  "circuit":      "policy-compliance"
}
```

## Dev mode vs full proofs

Controlled by `RISC0_DEV_MODE`. **Never flip this to 0 in production paths without reading [VERIFIER_KEYS.md](VERIFIER_KEYS.md) first.**

| Mode | `RISC0_DEV_MODE` | Receipt | Seal prefix | Wall-clock | Verifier |
|---|---|---|---|---|---|
| Dev | `1` | `InnerReceipt::Fake` | `0xFFFFFFFF` mock selector | seconds | `RiscZeroMockVerifier` (no crypto) |
| Full | `0` | Real Groth16 | Groth16 selector | minutes (CPU) | `RiscZeroGroth16Verifier` |

CI runs dev-mode on every PR (`zk` job). Full Groth16 runs only on labeled PRs (`full-zk`), tags, or manual dispatch (`zk-full` job). See [.github/workflows/ci.yml](../.github/workflows/ci.yml).

## Local development

```bash
# Install toolchain (once)
curl -L https://risczero.com/install | bash
rzup install rust

# Dev-mode tests (fast)
cd zk && RISC0_DEV_MODE=1 cargo test -q

# Full proof of one circuit (slow; needs CUDA or Bonsai for sanity)
cd zk && RISC0_DEV_MODE=0 cargo build --release --bins
echo '<inputs>' | RISC0_DEV_MODE=0 ./target/release/prove_policy
```

See [BENCHMARKS.md](BENCHMARKS.md) for expected wall-clock.

## When guest code changes

Guest ELF bytes → image ID. **Image ID change = deployed verifier must be updated.** Checklist:

1. `cargo build --release --bins` in `zk/`.
2. `./target/release/dump_image_ids` — writes to [config/zk-image-ids.json](../config/zk-image-ids.json).
3. Run `pnpm verify:addresses` and contracts deploy scripts to pick up the new IDs.
4. Bump the relevant circuit's guest crate `version` in its `Cargo.toml`.

Details and migration steps: [VERIFIER_KEYS.md](VERIFIER_KEYS.md).

## Design doc

`absolute-docs/04_zk_proof_system.md` is the canonical design reference. This directory is the implementation; when they disagree, the code wins and the design doc gets a PR.
