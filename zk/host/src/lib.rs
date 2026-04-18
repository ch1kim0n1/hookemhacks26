//! Host-side wrappers for the ClawGuard zkVM circuits.
//!
//! Each `prove_*` function runs the corresponding guest under
//! `ProverOpts::groth16()` and returns a `ProofArtifacts`:
//!
//!   - `seal`          — Groth16 seal bytes via
//!                       `risc0_ethereum_contracts::encode_seal`. Pass
//!                       directly as the first arg to
//!                       `IRiscZeroVerifier.verify`.
//!   - `journal_bytes` — raw journal committed via `env::commit_slice`.
//!   - `public_inputs` — journal sliced into 32-byte chunks, in
//!                       guest-defined order.
//!
//! With `RISC0_DEV_MODE=1` the receipt is `InnerReceipt::Fake` and
//! `encode_seal` prepends the `0xFFFFFFFF` mock-verifier selector. Deploy
//! `RiscZeroMockVerifier` in that case, `RiscZeroGroth16Verifier` with
//! `RISC0_DEV_MODE=0`.

use anyhow::{Context, Result};
use risc0_ethereum_contracts::encode_seal;
use risc0_zkvm::{default_prover, ExecutorEnv, ProverOpts, VerifierContext};
use sentinel_zk_shared::{
    GuestInputs, LearningInputs, LEARNING_JOURNAL_LEN, POLICY_JOURNAL_LEN,
};

include!(concat!(env!("OUT_DIR"), "/methods.rs"));

pub struct ProofArtifacts {
    pub seal: Vec<u8>,
    pub journal_bytes: Vec<u8>,
    pub public_inputs: Vec<[u8; 32]>,
    pub image_id: [u8; 32],
    pub elapsed: std::time::Duration,
}

fn prove<T: serde::Serialize>(
    inputs: &T,
    elf: &[u8],
    image_id: [u32; 8],
    expected_journal_len: usize,
) -> Result<ProofArtifacts> {
    let env = ExecutorEnv::builder()
        .write(inputs)
        .context("write guest inputs")?
        .build()
        .context("build executor env")?;

    let start = std::time::Instant::now();
    let receipt = default_prover()
        .prove_with_ctx(
            env,
            &VerifierContext::default(),
            elf,
            &ProverOpts::groth16(),
        )
        .context("prove (groth16)")?
        .receipt;
    let elapsed = start.elapsed();

    let seal = encode_seal(&receipt).context("encode_seal")?;
    let journal_bytes = receipt.journal.bytes.clone();
    if journal_bytes.len() != expected_journal_len {
        anyhow::bail!(
            "unexpected journal length: got {} want {}",
            journal_bytes.len(),
            expected_journal_len
        );
    }

    let public_inputs = journal_bytes
        .chunks_exact(32)
        .map(|c| {
            let mut b = [0u8; 32];
            b.copy_from_slice(c);
            b
        })
        .collect();

    Ok(ProofArtifacts {
        seal,
        journal_bytes,
        public_inputs,
        image_id: image_id_to_bytes32(image_id),
        elapsed,
    })
}

pub fn prove_scan(inputs: &GuestInputs) -> Result<ProofArtifacts> {
    prove(inputs, SCAN_ATTESTATION_ELF, SCAN_ATTESTATION_ID, POLICY_JOURNAL_LEN)
}

pub fn prove_defense_update(inputs: &LearningInputs) -> Result<ProofArtifacts> {
    prove(
        inputs,
        DEFENSE_UPDATE_CORRECTNESS_ELF,
        DEFENSE_UPDATE_CORRECTNESS_ID,
        LEARNING_JOURNAL_LEN,
    )
}

pub fn scan_attestation_image_id() -> [u32; 8] {
    SCAN_ATTESTATION_ID
}

pub fn defense_update_correctness_image_id() -> [u32; 8] {
    DEFENSE_UPDATE_CORRECTNESS_ID
}

/// Convert an image ID to `bytes32`. The 8 `u32` limbs are little-endian,
/// matching what `risc0_zkvm::sha::Digest` produces and what the on-chain
/// verifier expects.
pub fn image_id_to_bytes32(id: [u32; 8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, w) in id.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&w.to_le_bytes());
    }
    out
}
