# Verifier Keys — Image-ID Distribution & Pinning

RISC Zero's verification model uses a **universal Groth16 verifier** with a per-circuit **image ID** (hash of the compiled guest ELF). We don't run a circuit-specific trusted setup; we commit to the binary.

This document describes how image IDs move from `cargo build` to the deployed Solidity verifier, what can go wrong, and how to roll guest code safely.

## Trusted setup: there isn't one per circuit

- RISC Zero's Groth16 wrapper is a **universal** verifier with a one-time Powers-of-Tau ceremony performed by RISC Zero. We consume that as an upstream dependency (`risc0-ethereum v3.0.1`). SENTINEL does not run a ceremony.
- Per-circuit correctness is enforced by the verifier comparing a claimed `imageId` against a pinned `imageId` stored in the consuming contract. If the guest ELF changes by a byte, the image ID changes, and every contract pinning the old ID must be redeployed or upgraded.

## What gets committed where

| Artifact | Produced by | Lives at |
|---|---|---|
| Guest ELFs | `cargo build --release` in `zk/host/` (via `risc0_build::embed_methods()`) | Embedded into the host binary; not checked in |
| Image IDs (source of truth) | `zk/host/src/bin/dump_image_ids.rs` | Written to [../config/zk-image-ids.json](../config/zk-image-ids.json) |
| Pinned on-chain | contracts' constructors / deploy scripts | `PolicyRegistry`, `CounterfactualVerifier`, `LearningLoopVerifier` |
| Legacy mirror | (kept for reference only) | [../config/image-ids.json](../config/image-ids.json) |

**Only [config/zk-image-ids.json](../config/zk-image-ids.json) is authoritative.** The second file exists for back-compat with older scripts and will be removed in a future clean-up pass.

Current pinned values: open [../config/zk-image-ids.json](../config/zk-image-ids.json). The `_note` field documents which IDs are real Groth16 and which are dev-mode placeholders.

## Byte order

Image IDs are 8 × `u32` limbs. [host/src/lib.rs](host/src/lib.rs)'s `image_id_to_bytes32` writes each limb **little-endian**, matching `risc0_zkvm::sha::Digest` and what `RiscZeroGroth16Verifier` expects. `tests/policy_smoke.rs::image_id_to_bytes32_preserves_limbs_little_endian` pins this contract — do not change it without updating the verifier integration end-to-end.

## Rolling a guest change

Any change to a guest crate (source, deps, Rust toolchain version, `risc0-zkvm` version) produces a new ELF, therefore a new image ID.

Checklist:

1. **Bump the guest crate version.** `Cargo.toml` inside the guest crate — use semver patch for non-logic changes, minor for new public inputs, major for journal-layout or statement changes.
2. **Rebuild.** `cd zk && cargo build --release --bins`.
3. **Dump.** `./target/release/dump_image_ids` — overwrites [../config/zk-image-ids.json](../config/zk-image-ids.json).
4. **Diff the file.** Confirm only the circuits you expected to change did. If a circuit you didn't touch moved, something else changed (toolchain, a workspace dep) — investigate before shipping.
5. **Redeploy verifiers.** Run the contracts deploy script that picks up [../config/zk-image-ids.json](../config/zk-image-ids.json). Record the new contract addresses in [../config/addresses.local.json](../config/addresses.local.json) (or the target network's addresses file).
6. **Re-publish.** Frontend and services pull addresses via [../scripts/verify-addresses.mjs](../scripts/verify-addresses.mjs) — run it and fix any mismatches.
7. **Label the PR.** Add `full-zk` to exercise the `zk-full` CI job — it proves real Groth16 receipts end-to-end. The default `zk` job runs dev-mode only.

## Dev-mode placeholders

Under `RISC0_DEV_MODE=1`:

- The prover returns `InnerReceipt::Fake`; `encode_seal` prepends the mock selector `0xFFFFFFFF`.
- Contracts deployed with placeholder image IDs (e.g. the `0x0101...` and `0x0202...` sentinels in [config/zk-image-ids.json](../config/zk-image-ids.json)) **must** use `RiscZeroMockVerifier`, which ignores the ID entirely.
- **Never** flip `RISC0_DEV_MODE=0` against a contract that still holds a placeholder ID. The verifier will accept the seal format but the journal digest won't bind to anything meaningful, and `RiscZeroGroth16Verifier` will reject every real receipt because the ID doesn't match a real ELF.

CI enforces the split: the `zk` job pins `RISC0_DEV_MODE=1`, the `zk-full` job pins `RISC0_DEV_MODE=0` and rebuilds the ELFs fresh.

## Reproducible builds

RISC Zero guest builds are reproducible given the same toolchain. CI installs `rzup` and `rzup install rust` — devs should use the same launcher, not a locally installed `cargo-risczero`. If you need to audit a pinned image ID, rebuild on a clean machine with the pinned `rzup` version and compare bytes.

## Emergency: rotate a guest

If a guest bug requires a fast rotation:

1. Land the fix.
2. Bump the guest crate version (minor or major).
3. Follow the roll checklist above.
4. On-chain, have the admin call the relevant `setVerifier(...)` or redeploy the verifier and call `setVerifier` on the registry. Old proofs under the old image ID will stop verifying.
5. Document the rotation in the contracts' changelog — consumers that cache proofs need to re-prove.

## Related

- [README.md](README.md) — top-level zk overview
- [BENCHMARKS.md](BENCHMARKS.md) — proving / verify / seal envelope
- [../absolute-docs/04_zk_proof_system.md](../absolute-docs/04_zk_proof_system.md) — design reference
