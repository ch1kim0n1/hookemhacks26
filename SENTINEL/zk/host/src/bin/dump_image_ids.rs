//! Writes the three circuit image IDs (as 0x-prefixed bytes32 hex) to a
//! JSON file the Solidity deploy script reads. Image IDs are baked into
//! the guest ELFs at Rust build time and cannot be recomputed on-chain,
//! so we hand them across the language boundary via this artifact.
//!
//! Default output: <repo>/config/zk-image-ids.json
//! Override with: `dump_image_ids <path>`

use anyhow::{Context, Result};
use sentinel_zk_host::{
    counterfactual_correctness_image_id, image_id_to_bytes32, learning_correctness_image_id,
    policy_compliance_image_id,
};
use std::path::PathBuf;

fn main() -> Result<()> {
    let out_path = std::env::args().nth(1).map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../config/zk-image-ids.json"))
    });

    let policy = format!("0x{}", hex::encode(image_id_to_bytes32(policy_compliance_image_id())));
    let counterfactual = format!(
        "0x{}",
        hex::encode(image_id_to_bytes32(counterfactual_correctness_image_id()))
    );
    let learning = format!(
        "0x{}",
        hex::encode(image_id_to_bytes32(learning_correctness_image_id()))
    );

    let obj = serde_json::json!({
        "PolicyCompliance": policy,
        "CounterfactualCorrectness": counterfactual,
        "LearningLoopCorrectness": learning,
    });

    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).context("create output dir")?;
    }
    std::fs::write(&out_path, serde_json::to_string_pretty(&obj)?)
        .with_context(|| format!("write {}", out_path.display()))?;

    eprintln!("wrote image IDs to {}", out_path.display());
    println!("{}", serde_json::to_string(&obj)?);
    Ok(())
}
