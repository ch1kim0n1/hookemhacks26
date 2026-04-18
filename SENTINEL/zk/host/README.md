# `sentinel-zk-host` — host wrappers and CLIs

Host-side library + four binaries that drive the three RISC Zero guest programs.

## Library — `src/lib.rs`

Three thin wrappers, one conversion helper, one result struct.

```rust
pub struct ProofArtifacts {
    pub seal: Vec<u8>,          // encode_seal(receipt) — pass to IRiscZeroVerifier.verify
    pub journal_bytes: Vec<u8>, // raw committed journal
    pub public_inputs: Vec<[u8; 32]>, // journal sliced into 32-byte chunks
    pub image_id: [u8; 32],
    pub elapsed: std::time::Duration,
}

pub fn prove_policy(&GuestInputs)         -> Result<ProofArtifacts>;
pub fn prove_counterfactual(&Counterfact) -> Result<ProofArtifacts>;
pub fn prove_learning(&LearningInputs)    -> Result<ProofArtifacts>;

pub fn policy_compliance_image_id()         -> [u32; 8];
pub fn counterfactual_correctness_image_id()-> [u32; 8];
pub fn learning_correctness_image_id()      -> [u32; 8];
pub fn image_id_to_bytes32(id: [u32; 8])    -> [u8; 32];
```

All three `prove_*` functions:

1. Build `ExecutorEnv` with serde-encoded inputs.
2. Invoke `default_prover().prove_with_ctx(..., &ProverOpts::groth16())`.
3. Assert `receipt.journal.bytes.len() == expected_journal_len`.
4. Compress to a Solidity-ready seal via `risc0_ethereum_contracts::encode_seal`.

Under `RISC0_DEV_MODE=1` the prover returns `InnerReceipt::Fake` and `encode_seal` prepends the `0xFFFFFFFF` selector for `RiscZeroMockVerifier`. Swap to `RiscZeroGroth16Verifier` with `RISC0_DEV_MODE=0`.

## Binaries

All CLIs read JSON from stdin, emit a single JSON line on stdout, and use stderr for progress.

| Binary | Input | Journal | Emits `circuit` |
|---|---|---|---|
| [`prove_policy`](src/bin/prove_policy.rs) | `GuestInputs` | 96 B | `"policy-compliance"` |
| [`prove_counterfactual`](src/bin/prove_counterfactual.rs) | `CounterfactualInputs` | 160 B | `"counterfactual-correctness"` |
| [`prove_learning`](src/bin/prove_learning.rs) | `LearningInputs` | 128 B | `"learning-correctness"` |
| [`dump_image_ids`](src/bin/dump_image_ids.rs) | — | — | writes `config/zk-image-ids.json` |

Standard output envelope:

```json
{
  "proof":        "0x<seal hex>",
  "publicInputs": ["0x<32B hex>", "..."],
  "imageId":      "0x<32B hex>",
  "journal":      "0x<journal hex>",
  "elapsedMs":    <int>,
  "circuit":      "<name>"
}
```

## `build.rs`

One line: `risc0_build::embed_methods()`. Compiles every guest listed under `[package.metadata.risc0].methods` in [Cargo.toml](Cargo.toml) and emits `<NAME>_ELF` / `<NAME>_ID` constants into `OUT_DIR/methods.rs`, which `lib.rs` includes.

## Image-ID endianness

Image IDs are 8 × `u32` limbs. `image_id_to_bytes32` writes each limb little-endian, matching `risc0_zkvm::sha::Digest` and what the Solidity verifier expects. The unit test in [tests/policy_smoke.rs](tests/policy_smoke.rs) pins this contract.

## Tests

[tests/policy_smoke.rs](tests/policy_smoke.rs) runs without a full prove — it only checks that each image ID is non-zero, the three are distinct, and the little-endian byte order holds. Real Groth16 regression runs in the `zk-full` CI job ([../.github/workflows/ci.yml](../../.github/workflows/ci.yml)).

## Consumers

- [services/zk-prover](../../services/zk-prover/) — wraps the CLIs, exposes `/prove/*` over HTTP, caches by `sha256(input_json)`.
- [scripts/prove-policy.sh](../../scripts/prove-policy.sh), [scripts/pre-warm-proofs.sh](../../scripts/pre-warm-proofs.sh) — demo orchestration.
