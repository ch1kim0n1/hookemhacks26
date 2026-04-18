//! CLI host for the CounterfactualCorrectness circuit.
//!
//! Usage:   echo '<CounterfactualInputs JSON>' | prove_counterfactual
//! Output:  { "proof": "0x...", "publicInputs": ["0x..."; 4],
//!            "imageId": "0x...", "elapsedMs": N,
//!            "circuit": "counterfactual-correctness" }
//!
//! publicInputs order: [eventId, counterfactualRoot, deltaWei, victimProtocol].

use anyhow::{Context, Result};
use sentinel_zk_host::prove_counterfactual;
use sentinel_zk_shared::CounterfactualInputs;
use std::io::Read;

fn main() -> Result<()> {
    let mut raw = String::new();
    std::io::stdin()
        .read_to_string(&mut raw)
        .context("read stdin")?;
    let inputs: CounterfactualInputs =
        serde_json::from_str(&raw).context("parse CounterfactualInputs JSON")?;

    eprintln!(
        "[prove_counterfactual] starting proof over {} deltas",
        inputs.deltas.len()
    );

    let artifacts = prove_counterfactual(&inputs)?;

    eprintln!(
        "[prove_counterfactual] proof generated in {:.2?}",
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
        "circuit": "counterfactual-correctness",
    });

    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}
