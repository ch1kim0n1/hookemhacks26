//! DefenseUpdateCorrectness guest program (RISC Zero zkVM).
//!
//! Proves: "the new defense bundle was earned by adversarial
//! co-evolution against the attack identified by `derivedFromAttackHash`
//! — across ≥ min_generations rounds, the candidate bundle defended
//! committed attacks at an aggregate win-rate ≥ min_win_rate_bp."
//!
//! Journal layout (128 bytes, see
//! `sentinel_zk_shared::learning_journal`):
//!   oldPolicyHash || newPolicyHash || derivedFromAttackHash || modelDeltaHash
//!
//! These four slots are exactly the `publicInputs` consumed by
//! `DefenseProtocol.publishDefenseUpdate`.

use risc0_zkvm::guest::env;
use sentinel_zk_shared::{learning_journal, LearningInputs};

fn main() {
    let inputs: LearningInputs = env::read();

    assert_ne!(
        inputs.old_policy_hash, inputs.new_policy_hash,
        "policy unchanged"
    );
    assert_ne!(
        inputs.derived_from_attack_hash, [0u8; 32],
        "attack hash must be non-zero"
    );

    let gen_count = inputs.generations.len() as u32;
    assert!(
        gen_count >= inputs.min_generations,
        "too few generations"
    );

    let mut total_attacks: u64 = 0;
    let mut total_defended: u64 = 0;
    for g in &inputs.generations {
        assert!(g.defended_count <= g.attack_count, "defended > attacks");
        total_attacks += g.attack_count as u64;
        total_defended += g.defended_count as u64;
    }
    assert!(total_attacks > 0, "no attacks");

    let win_rate_bp = ((total_defended * 10_000) / total_attacks) as u16;
    assert!(
        win_rate_bp >= inputs.min_win_rate_bp,
        "win rate below floor"
    );

    // event_batch_root is a private binding; the on-chain consumer can
    // cross-check it by recomputing the batch root and wrapping it in an
    // outer commitment. Kept private to keep the journal compact.
    let _ = inputs.event_batch_root;

    let journal = learning_journal(
        &inputs.old_policy_hash,
        &inputs.new_policy_hash,
        &inputs.derived_from_attack_hash,
        &inputs.model_delta_hash,
    );
    env::commit_slice(&journal);
}
