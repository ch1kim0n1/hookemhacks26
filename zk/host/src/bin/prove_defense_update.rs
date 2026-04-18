//! CLI host for the DefenseUpdateCorrectness circuit
//! (renamed from LearningLoopCorrectness).
//!
//! Usage:   echo '<LearningInputs JSON>' | prove_defense_update
//! Output:  { "proof": "0x...", "publicInputs": ["0x..."; 4],
//!            "imageId": "0x...", "elapsedMs": N,
//!            "circuit": "defense-update-correctness" }
//!
//! publicInputs order: [oldPolicyHash, newPolicyHash, winRateBp, generationCount].

use anyhow::{Context, Result};
use clawguard_zk_host::prove_defense_update;
use sentinel_zk_shared::LearningInputs;
use std::io::Read;

fn main() -> Result<()> {
    let mut raw = String::new();
    std::io::stdin()
        .read_to_string(&mut raw)
        .context("read stdin")?;
    let inputs: LearningInputs =
        serde_json::from_str(&raw).context("parse LearningInputs JSON")?;

    eprintln!(
        "[prove_defense_update] starting proof over {} generations",
        inputs.generations.len()
    );

    let artifacts = prove_defense_update(&inputs)?;

    eprintln!(
        "[prove_defense_update] proof generated in {:.2?}",
        artifacts.elapsed
    );

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
        "circuit": "defense-update-correctness",
    });

    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}
