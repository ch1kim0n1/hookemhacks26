//! PolicyCompliance guest program (RISC Zero zkVM).
//!
//! Proves: "given the current policy P, the proposed action A is an
//! authorized response to the threat evidence E" — without revealing
//! the policy or the evidence.
//!
//! Journal layout (96 bytes, see `sentinel_zk_shared::policy_journal`):
//!   actionHash || policyHash || eventId
//!
//! See absolute-docs/04_zk_proof_system.md §PolicyCompliance.

use risc0_zkvm::guest::env;
use sentinel_zk_shared::{classifier_score, policy_journal, GuestInputs, Policy};
use sha2::{Digest, Sha256};

fn main() {
    let inputs: GuestInputs = env::read();

    // 1. Parse policy from canonicalized JSON.
    let policy: Policy =
        serde_json::from_str(&inputs.policy_json).expect("policy JSON must parse");

    // 2. Hash policy for the journal. This hash commits to the
    //    classifier weights (if any), so the on-chain verifier binds
    //    the proof to the exact model that ran in-circuit.
    let mut hasher = Sha256::new();
    hasher.update(inputs.policy_json.as_bytes());
    let policy_hash: [u8; 32] = hasher.finalize().into();

    // 3. Find a rule matching the evidence pattern. Panic = no proof =
    //    the Agent Constraint Failure demo (doc 05 §Scenario B).
    let rule = policy
        .rules
        .iter()
        .find(|r| r.pattern == inputs.evidence.pattern)
        .expect("no rule matches evidence pattern");

    assert!(
        inputs.evidence.confidence >= rule.min_confidence,
        "confidence below policy floor"
    );
    assert_eq!(
        inputs.action.target, inputs.evidence.victim_protocol,
        "action target != victim protocol"
    );
    let selector_ok = rule
        .authorized_selectors
        .iter()
        .any(|s| *s == inputs.action.selector);
    assert!(selector_ok, "selector not authorized by rule");

    // 3b. On-chain inference gate. Priority: MLP > linear classifier.
    //     Either gate, when declared, runs inside the zkVM; no Groth16
    //     seal is emitted unless the model clears the policy threshold.
    //     The model weights are covered by policyHash, so the on-chain
    //     verifier is cryptographically bound to the exact network that
    //     ran. This is literal on-chain inference: the model runs
    //     inside the proof, the chain verifies the proof.
    if let Some(mlp) = policy.mlp.as_ref() {
        // Let `nn::forward` be the single source of truth for dim checks.
        let score = sentinel_zk_shared::nn::forward(mlp, &inputs.evidence.features)
            .expect("mlp: feature/weight dimensions must match policy");
        assert!(
            score >= mlp.threshold,
            "mlp score below threshold — action rejected"
        );
    } else if let Some(clf) = policy.classifier.as_ref() {
        assert_eq!(
            clf.weights.len(),
            clf.feature_names.len(),
            "classifier: weights/feature_names length mismatch"
        );
        assert_eq!(
            clf.weights.len(),
            inputs.evidence.features.len(),
            "classifier: features length != weights length"
        );
        let score = classifier_score(&clf.weights, clf.bias, &inputs.evidence.features)
            .expect("classifier score must compute (length checked above)");
        assert!(
            score >= clf.threshold,
            "classifier score below threshold — action rejected"
        );
    }

    // 4. Action hash = sha256(target || calldata).
    let mut ah = Sha256::new();
    ah.update(inputs.action.target);
    ah.update(&inputs.action.calldata);
    let action_hash: [u8; 32] = ah.finalize().into();

    // 5. Commit journal as raw 96 bytes.
    let journal = policy_journal(&action_hash, &policy_hash, &inputs.evidence.event_id);
    env::commit_slice(&journal);
}
