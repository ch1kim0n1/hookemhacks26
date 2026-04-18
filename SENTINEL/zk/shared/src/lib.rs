//! Types shared between the zkVM guest programs and the host wrapper.
//! `no_std`-compatible so the guest (which runs with std stubbed) can use them.
//!
//! Guests emit journals as raw bytes via `env::commit_slice` using the
//! `ABI_*` layouts documented below. Each field is a fixed 32-byte
//! big-endian slot, so the on-chain wrapper can reconstruct the journal
//! bytes with `abi.encodePacked(bytes32, bytes32, ...)` and compute
//! `journalDigest = sha256(journal)` — no risc0-specific serde needed
//! on-chain.

#![no_std]

extern crate alloc;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

pub mod nn;
pub use nn::{DenseLayer, TinyMlp};

// ---------------------------------------------------------------------------
// PolicyCompliance
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub target: [u8; 20],
    pub selector: [u8; 4],
    pub calldata: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evidence {
    pub event_id: [u8; 32],
    pub pattern: String,
    /// basis points 0-10000.
    pub confidence: u16,
    pub victim_protocol: [u8; 20],
    /// Numeric features scaled to basis points (0-10000).
    /// Consumed by the on-chain classifier when the policy declares one.
    /// Order MUST match `Policy.classifier.feature_names`. Legacy clients
    /// without this field still work — a policy without a classifier
    /// ignores features entirely.
    #[serde(default)]
    pub features: Vec<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Policy {
    pub version: u32,
    pub rules: Vec<PolicyRule>,
    /// Optional ZK-gated linear classifier. When present, the guest
    /// evaluates it against `evidence.features` and panics (no proof)
    /// unless the score clears the threshold. The classifier weights
    /// are covered by `policyHash` (sha256 of the canonical policy
    /// JSON), so the on-chain verifier cryptographically commits to
    /// the exact model that ran in-circuit.
    #[serde(default)]
    pub classifier: Option<LinearClassifier>,
    /// Optional 2-layer MLP (N→M ReLU→1). When present, takes
    /// precedence over `classifier`: the guest runs `nn::forward`
    /// against `evidence.features` and panics unless the scalar
    /// activation clears `threshold`. Committed in `policyHash` just
    /// like everything else in this struct.
    #[serde(default)]
    pub mlp: Option<nn::TinyMlp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRule {
    pub pattern: String,
    pub min_confidence: u16,
    pub authorized_selectors: Vec<[u8; 4]>,
}

/// Fixed-point linear classifier evaluated inside the zkVM.
///
/// `score = Σ weights[i] * features[i] + bias` (all i64 to avoid overflow);
/// action is authorized iff `score >= threshold`. Keeping weights and
/// features as scaled integers avoids floating point in the circuit and
/// makes the score bit-exact-reproducible off-chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearClassifier {
    pub feature_names: Vec<String>,
    pub weights: Vec<i32>,
    pub bias: i32,
    pub threshold: i64,
}

/// In-circuit linear classifier evaluation. Pure, deterministic, no_std.
/// Returns the signed score so callers can expose it for UI/audit while
/// the guest uses the sign of `score - threshold` to gate the proof.
///
/// # Errors
/// Returns `None` if weights and features have different lengths — the
/// guest treats this as a hard failure (no proof is emitted).
pub fn classifier_score(weights: &[i32], bias: i32, features: &[i32]) -> Option<i64> {
    if weights.len() != features.len() {
        return None;
    }
    let mut acc: i64 = bias as i64;
    for (w, f) in weights.iter().zip(features.iter()) {
        acc = acc.saturating_add((*w as i64).saturating_mul(*f as i64));
    }
    Some(acc)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestInputs {
    pub policy_json: String,
    pub action: Action,
    pub evidence: Evidence,
}

/// Journal layout (96 bytes): actionHash || policyHash || eventId.
pub const POLICY_JOURNAL_LEN: usize = 96;

pub fn policy_journal(action_hash: &[u8; 32], policy_hash: &[u8; 32], event_id: &[u8; 32]) -> [u8; POLICY_JOURNAL_LEN] {
    let mut out = [0u8; POLICY_JOURNAL_LEN];
    out[0..32].copy_from_slice(action_hash);
    out[32..64].copy_from_slice(policy_hash);
    out[64..96].copy_from_slice(event_id);
    out
}

// ---------------------------------------------------------------------------
// CounterfactualCorrectness (structured claim)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CounterfactualDelta {
    /// Content-addressed identifier for the delta source; e.g.
    /// `sha256(label_bytes)` for balance-based simulations or a raw
    /// tx hash for execution-trace-based ones.
    pub key: [u8; 32],
    /// Signed balance delta in wei, big-endian two's-complement.
    pub delta_wei_be: [u8; 32],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CounterfactualInputs {
    pub event_id: [u8; 32],
    pub victim_protocol: [u8; 20],
    pub deltas: Vec<CounterfactualDelta>,
    pub claimed_delta_wei_be: [u8; 32],
    /// Block hash of the fork that produced Timeline B.
    /// Non-zero value binds this proof to a specific historical block,
    /// grounding the counterfactual simulation in provable on-chain state
    /// (Approach A / Hybrid per doc 04 §CounterfactualCorrectness).
    /// Deserialises as all-zeros when absent so existing callers still work.
    #[serde(default)]
    pub fork_block_hash: [u8; 32],
}

/// Journal layout (160 bytes):
///   eventId || counterfactualRoot || deltaWei || victimProtocol (left-padded)
///   || forkBlockHash
pub const COUNTERFACTUAL_JOURNAL_LEN: usize = 160;

pub fn counterfactual_journal(
    event_id: &[u8; 32],
    counterfactual_root: &[u8; 32],
    delta_wei_be: &[u8; 32],
    victim_protocol: &[u8; 20],
    fork_block_hash: &[u8; 32],
) -> [u8; COUNTERFACTUAL_JOURNAL_LEN] {
    let mut out = [0u8; COUNTERFACTUAL_JOURNAL_LEN];
    out[0..32].copy_from_slice(event_id);
    out[32..64].copy_from_slice(counterfactual_root);
    out[64..96].copy_from_slice(delta_wei_be);
    // Left-pad 20-byte address into a 32-byte slot.
    out[96 + 12..96 + 32].copy_from_slice(victim_protocol);
    out[128..160].copy_from_slice(fork_block_hash);
    out
}

// ---------------------------------------------------------------------------
// LearningLoopCorrectness
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningGeneration {
    pub attack_count: u32,
    pub defended_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningInputs {
    pub old_policy_hash: [u8; 32],
    pub new_policy_hash: [u8; 32],
    /// Minimum defended/attacked ratio in basis points.
    pub min_win_rate_bp: u16,
    pub min_generations: u32,
    pub event_batch_root: [u8; 32],
    pub generations: Vec<LearningGeneration>,
}

/// Journal layout (128 bytes):
///   oldPolicyHash || newPolicyHash || winRateBp (uint256 BE) || generationCount (uint256 BE)
pub const LEARNING_JOURNAL_LEN: usize = 128;

pub fn learning_journal(
    old_policy_hash: &[u8; 32],
    new_policy_hash: &[u8; 32],
    win_rate_bp: u16,
    generation_count: u32,
) -> [u8; LEARNING_JOURNAL_LEN] {
    let mut out = [0u8; LEARNING_JOURNAL_LEN];
    out[0..32].copy_from_slice(old_policy_hash);
    out[32..64].copy_from_slice(new_policy_hash);
    // uint256 big-endian: top 30 bytes zero, low 2 bytes = win_rate_bp.
    out[64 + 30..64 + 32].copy_from_slice(&win_rate_bp.to_be_bytes());
    // uint256 big-endian: top 28 bytes zero, low 4 bytes = generation_count.
    out[96 + 28..96 + 32].copy_from_slice(&generation_count.to_be_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------------- PolicyCompliance ----------------

    #[test]
    fn policy_journal_layout_matches_abi() {
        let action_hash = [0xAAu8; 32];
        let policy_hash = [0xBBu8; 32];
        let event_id = [0xCCu8; 32];
        let j = policy_journal(&action_hash, &policy_hash, &event_id);

        assert_eq!(j.len(), POLICY_JOURNAL_LEN);
        assert_eq!(&j[0..32], &action_hash);
        assert_eq!(&j[32..64], &policy_hash);
        assert_eq!(&j[64..96], &event_id);
    }

    #[test]
    fn policy_journal_slots_are_independent() {
        // Flipping any one slot must only affect its own window.
        let zero = [0u8; 32];
        let one = [1u8; 32];
        let a = policy_journal(&one, &zero, &zero);
        let b = policy_journal(&zero, &one, &zero);
        let c = policy_journal(&zero, &zero, &one);

        assert_ne!(a, b);
        assert_ne!(b, c);
        assert_ne!(a, c);
        // Non-active slots stay zero.
        assert!(a[32..].iter().all(|&x| x == 0));
        assert!(b[..32].iter().all(|&x| x == 0));
        assert!(b[64..].iter().all(|&x| x == 0));
        assert!(c[..64].iter().all(|&x| x == 0));
    }

    // ---------------- CounterfactualCorrectness ----------------

    #[test]
    fn counterfactual_journal_layout_matches_abi() {
        let event_id = [0x01u8; 32];
        let root = [0x02u8; 32];
        let delta = [0x03u8; 32];
        let victim = [0x04u8; 20];
        let fork = [0x05u8; 32];

        let j = counterfactual_journal(&event_id, &root, &delta, &victim, &fork);

        assert_eq!(j.len(), COUNTERFACTUAL_JOURNAL_LEN);
        assert_eq!(&j[0..32], &event_id);
        assert_eq!(&j[32..64], &root);
        assert_eq!(&j[64..96], &delta);
        // Address left-padded into 32-byte slot: bytes 96..108 = 0, 108..128 = address.
        assert!(j[96..108].iter().all(|&x| x == 0), "address padding");
        assert_eq!(&j[108..128], &victim);
        assert_eq!(&j[128..160], &fork);
    }

    #[test]
    fn counterfactual_zero_fork_hash_ok() {
        // Approach A allows zero fork_block_hash for back-compat.
        let j = counterfactual_journal(&[0u8; 32], &[0u8; 32], &[0u8; 32], &[0u8; 20], &[0u8; 32]);
        assert!(j.iter().all(|&b| b == 0));
    }

    #[test]
    fn counterfactual_address_padding_never_collides() {
        // Two addresses differing in only the last byte must produce
        // journals differing in exactly that slot.
        let mut a = [0u8; 20];
        let mut b = [0u8; 20];
        a[19] = 0x42;
        b[19] = 0x43;
        let ja = counterfactual_journal(&[0u8; 32], &[0u8; 32], &[0u8; 32], &a, &[0u8; 32]);
        let jb = counterfactual_journal(&[0u8; 32], &[0u8; 32], &[0u8; 32], &b, &[0u8; 32]);

        // Identical except one byte at offset 127.
        for i in 0..160 {
            if i == 127 {
                assert_ne!(ja[i], jb[i]);
            } else {
                assert_eq!(ja[i], jb[i], "byte {} should match", i);
            }
        }
    }

    // ---------------- LearningLoopCorrectness ----------------

    #[test]
    fn learning_journal_layout_matches_abi() {
        let old = [0x10u8; 32];
        let new = [0x11u8; 32];
        let j = learning_journal(&old, &new, 0x1234, 0x0ABCDEF0);

        assert_eq!(j.len(), LEARNING_JOURNAL_LEN);
        assert_eq!(&j[0..32], &old);
        assert_eq!(&j[32..64], &new);
        // win_rate_bp is uint256 big-endian: top 30 bytes zero, low 2 = 0x12 0x34.
        assert!(j[64..94].iter().all(|&b| b == 0));
        assert_eq!(j[94], 0x12);
        assert_eq!(j[95], 0x34);
        // generation_count is uint256 big-endian: top 28 bytes zero, low 4.
        assert!(j[96..124].iter().all(|&b| b == 0));
        assert_eq!(&j[124..128], &[0x0A, 0xBC, 0xDE, 0xF0]);
    }

    #[test]
    fn learning_journal_win_rate_bounds() {
        // Max basis points (10000 = 0x2710) and zero both round-trip.
        let j0 = learning_journal(&[0u8; 32], &[0u8; 32], 0, 0);
        assert!(j0[64..96].iter().all(|&b| b == 0));

        let jmax = learning_journal(&[0u8; 32], &[0u8; 32], 10000, 0);
        assert_eq!(jmax[94], 0x27);
        assert_eq!(jmax[95], 0x10);
    }

    #[test]
    fn learning_journal_generation_count_fits_uint32_max() {
        let j = learning_journal(&[0u8; 32], &[0u8; 32], 0, u32::MAX);
        assert_eq!(&j[124..128], &[0xFF, 0xFF, 0xFF, 0xFF]);
    }

    // ---------------- Serde round-trips ----------------

    #[test]
    fn guest_inputs_serde_roundtrip() {
        let inputs = GuestInputs {
            policy_json: alloc::string::String::from("{\"version\":1,\"rules\":[]}"),
            action: Action {
                target: [0xAA; 20],
                selector: [0x12, 0x34, 0x56, 0x78],
                calldata: alloc::vec![0x01, 0x02, 0x03],
            },
            evidence: Evidence {
                event_id: [0xEE; 32],
                pattern: alloc::string::String::from("flash_loan_oracle"),
                confidence: 9500,
                victim_protocol: [0xBB; 20],
                features: alloc::vec::Vec::new(),
            },
        };

        let bytes = serde_json::to_vec(&inputs).expect("serialize");
        let back: GuestInputs = serde_json::from_slice(&bytes).expect("deserialize");
        assert_eq!(back.action.target, inputs.action.target);
        assert_eq!(back.action.selector, inputs.action.selector);
        assert_eq!(back.evidence.confidence, 9500);
        assert_eq!(back.evidence.pattern, "flash_loan_oracle");
    }

    // ---------------- LinearClassifier (on-chain inference) ----------------

    #[test]
    fn classifier_score_matches_hand_computation() {
        // 3 * 100 + (-2) * 50 + 4 * 25 + 7 = 300 - 100 + 100 + 7 = 307.
        let score = classifier_score(&[3, -2, 4], 7, &[100, 50, 25]).unwrap();
        assert_eq!(score, 307);
    }

    #[test]
    fn classifier_score_rejects_mismatched_dims() {
        assert!(classifier_score(&[1, 2, 3], 0, &[10, 20]).is_none());
    }

    #[test]
    fn classifier_score_saturates_on_overflow() {
        // i32::MAX * i32::MAX would overflow i32 but fits in i64 after
        // saturating_mul. This proves the accumulator can't wrap.
        let s = classifier_score(&[i32::MAX, i32::MAX], 0, &[i32::MAX, i32::MAX]).unwrap();
        assert!(s > 0);
        // Deliberate negative weight + large feature: must not panic.
        let s2 = classifier_score(&[i32::MIN, i32::MAX], 0, &[i32::MAX, i32::MAX]).unwrap();
        assert!(s2 < 0);
    }

    #[test]
    fn classifier_decision_boundary_is_exact() {
        // Synthetic flash-loan features (basis points).
        let weights: [i32; 5] = [2, 3, 1, 1, 4];
        let bias: i32 = -15000;
        let threshold: i64 = 0;

        let benign = [1000, 500, 3000, 200, 0];
        let attack = [9500, 8000, 9000, 7500, 2];

        let benign_score = classifier_score(&weights, bias, &benign).unwrap();
        let attack_score = classifier_score(&weights, bias, &attack).unwrap();

        assert!(benign_score < threshold, "benign should be below threshold");
        assert!(attack_score >= threshold, "attack should meet threshold");
    }

    #[test]
    fn policy_with_classifier_serde_roundtrip() {
        let p = Policy {
            version: 1,
            rules: alloc::vec::Vec::new(),
            classifier: Some(LinearClassifier {
                feature_names: alloc::vec![
                    alloc::string::String::from("loan_bp"),
                    alloc::string::String::from("oracle_dev_bp"),
                ],
                weights: alloc::vec![2, 3],
                bias: -100,
                threshold: 0,
            }),
            mlp: None,
        };
        let bytes = serde_json::to_vec(&p).expect("serialize");
        let back: Policy = serde_json::from_slice(&bytes).expect("deserialize");
        let c = back.classifier.expect("classifier preserved");
        assert_eq!(c.weights, alloc::vec![2, 3]);
        assert_eq!(c.bias, -100);
    }

    #[test]
    fn policy_with_mlp_serde_roundtrip() {
        let p = Policy {
            version: 2,
            rules: alloc::vec::Vec::new(),
            classifier: None,
            mlp: Some(nn::TinyMlp {
                feature_names: alloc::vec![alloc::string::String::from("f")],
                hidden: nn::DenseLayer {
                    weights: alloc::vec![alloc::vec![1]],
                    biases: alloc::vec![0],
                },
                output: nn::DenseLayer {
                    weights: alloc::vec![alloc::vec![1]],
                    biases: alloc::vec![0],
                },
                threshold: 0,
                shift_bits: 0,
            }),
        };
        let bytes = serde_json::to_vec(&p).expect("serialize");
        let back: Policy = serde_json::from_slice(&bytes).expect("deserialize");
        assert!(back.mlp.is_some(), "mlp should serde round-trip");
    }

    #[test]
    fn policy_without_classifier_deserialises() {
        // Back-compat: pre-classifier policies must still parse.
        let json = r#"{"version":1,"rules":[]}"#;
        let p: Policy = serde_json::from_str(json).expect("legacy policy parses");
        assert!(p.classifier.is_none());
    }

    #[test]
    fn evidence_without_features_deserialises() {
        let json = r#"{
            "event_id":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
            "pattern":"X",
            "confidence":9000,
            "victim_protocol":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
        }"#;
        let e: Evidence = serde_json::from_str(json).expect("legacy evidence parses");
        assert!(e.features.is_empty());
    }

    #[test]
    fn counterfactual_inputs_default_fork_block_hash() {
        // Explicit: when fork_block_hash is missing in JSON, it deserialises
        // to all-zeros. Required for back-compat with pre-Hybrid-A callers.
        let json = r#"{
            "event_id": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
            "victim_protocol": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
            "deltas": [],
            "claimed_delta_wei_be": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
        }"#;
        let parsed: CounterfactualInputs =
            serde_json::from_str(json).expect("should parse without fork_block_hash");
        assert_eq!(parsed.fork_block_hash, [0u8; 32]);
    }
}
