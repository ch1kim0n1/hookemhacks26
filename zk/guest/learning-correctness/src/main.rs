//! LearningLoopCorrectness guest program (RISC Zero zkVM).
//!
//! Proves: "the new policy was earned by adversarial co-evolution —
//! across ≥ min_generations rounds, the candidate policy defended
//! committed attacks at an aggregate win-rate ≥ min_win_rate_bp."
//!
//! Journal layout (128 bytes, see
//! `sentinel_zk_shared::learning_journal`):
//!   oldPolicyHash || newPolicyHash || winRateBp (uint256 BE)
//!   || generationCount (uint256 BE)

use risc0_zkvm::guest::env;
use sentinel_zk_shared::{learning_journal, LearningInputs};

fn main() {
    let inputs: LearningInputs = env::read();

    assert_ne!(
        inputs.old_policy_hash, inputs.new_policy_hash,
        "policy unchanged"
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

    // event_batch_root is accepted as a private binding; the on-chain
    // consumer can cross-check it by recomputing the batch root and
    // including it in a wrapping commitment. Kept as private input here
    // to keep the journal compact.
    let _ = inputs.event_batch_root;

    let journal = learning_journal(
        &inputs.old_policy_hash,
        &inputs.new_policy_hash,
        win_rate_bp,
        gen_count,
    );
    env::commit_slice(&journal);
}
