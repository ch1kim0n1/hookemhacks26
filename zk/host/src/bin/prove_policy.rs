//! CLI host for the PolicyCompliance circuit.
//!
//! Usage:   echo '<GuestInputs JSON>' | prove_policy
//! Output:  { "proof": "0x...", "publicInputs": ["0x..."; 3],
//!            "imageId": "0x...", "elapsedMs": N }
//!
//! The JSON shape is the stable contract with `services/zk-prover`.
//! `publicInputs` is the 96-byte journal sliced into three bytes32
//! chunks in the order `[actionHash, policyHash, eventId]`.

use anyhow::{Context, Result};
use sentinel_zk_host::prove_policy;
use sentinel_zk_shared::GuestInputs;
use std::io::Read;

fn main() -> Result<()> {
    let mut raw = String::new();
    std::io::stdin()
        .read_to_string(&mut raw)
        .context("read stdin")?;
    let inputs: GuestInputs =
        serde_json::from_str(&raw).context("parse GuestInputs JSON")?;

    eprintln!(
        "[prove_policy] starting proof for pattern={} confidence={}bp",
        inputs.evidence.pattern, inputs.evidence.confidence
    );

    let artifacts = prove_policy(&inputs)?;

    eprintln!("[prove_policy] proof generated in {:.2?}", artifacts.elapsed);

    let public_inputs_hex: Vec<String> = artifacts
        .public_inputs
        .iter()
        .map(|b| format!("0x{}", hex::encode(b)))
        .collect();

    let output = serde_json::json!({
        "proof": format!("0x{}", hex::encode(&artifacts.seal)),
        "publicInputs": public_inputs_hex,
        "imageId": format!("0x{}", hex::encode(artifacts.image_id)),
        "journal": format!("0x{}", hex::encode(&artifacts.journal_bytes)),
        "elapsedMs": artifacts.elapsed.as_millis(),
        "circuit": "policy-compliance",
    });

    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}
