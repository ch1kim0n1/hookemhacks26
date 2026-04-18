//! CLI host for the ScanAttestation circuit (renamed from PolicyCompliance).
//!
//! Usage:   echo '<GuestInputs JSON>' | prove_scan
//! Output:  { "proof": "0x...", "publicInputs": ["0x..."; 3],
//!            "imageId": "0x...", "elapsedMs": N,
//!            "circuit": "scan-attestation" }
//!
//! `publicInputs` is the 96-byte journal sliced into three bytes32
//! chunks in the order `[actionHash, policyHash, eventId]`.

use anyhow::{Context, Result};
use clawguard_zk_host::prove_scan;
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
        "[prove_scan] starting proof for pattern={} confidence={}bp",
        inputs.evidence.pattern, inputs.evidence.confidence
    );

    let artifacts = prove_scan(&inputs)?;

    eprintln!("[prove_scan] proof generated in {:.2?}", artifacts.elapsed);

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
        "circuit": "scan-attestation",
    });

    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}
