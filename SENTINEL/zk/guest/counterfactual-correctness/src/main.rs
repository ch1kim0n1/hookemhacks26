//! CounterfactualCorrectness guest program (RISC Zero zkVM).
//!
//! Proves that a committed counterfactual-simulation result is internally
//! consistent — the sum of per-tx balance deltas equals the claimed
//! aggregate `delta_wei`, and the `counterfactual_root` commits to that
//! exact delta set under a SHA-256 Merkle tree.
//!
//! Hybrid Approach A/B (doc 04 §CounterfactualCorrectness):
//!   When `fork_block_hash` is non-zero the proof is also *grounded* in a
//!   specific historical block: the hash is included in the journal so the
//!   on-chain verifier can confirm it matches the canonical chain. This ties
//!   Timeline B to a provably real EVM state without requiring full revm
//!   execution inside the zkVM (the Approach A stretch goal).
//!   Callers that omit `fork_block_hash` (all-zeros) get the original
//!   Approach B structural-consistency proof.
//!
//! Journal layout (160 bytes, see
//! `sentinel_zk_shared::counterfactual_journal`):
//!   eventId || counterfactualRoot || deltaWei (BE two's-complement)
//!   || victimProtocol (left-padded to bytes32) || forkBlockHash

use risc0_zkvm::guest::env;
use sentinel_zk_shared::{counterfactual_journal, CounterfactualInputs};
use sha2::{Digest, Sha256};

fn add_twos_complement_be(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut carry: u16 = 0;
    for i in (0..32).rev() {
        let sum = a[i] as u16 + b[i] as u16 + carry;
        out[i] = sum as u8;
        carry = sum >> 8;
    }
    out
}

fn leaf_hash(key: &[u8; 32], delta_be: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update([0x00]);
    h.update(key);
    h.update(delta_be);
    h.finalize().into()
}

fn node_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update([0x01]);
    h.update(left);
    h.update(right);
    h.finalize().into()
}

fn merkle_root(leaves: &[[u8; 32]]) -> [u8; 32] {
    assert!(!leaves.is_empty(), "at least one leaf required");
    let mut level: Vec<[u8; 32]> = leaves.to_vec();
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        let mut i = 0;
        while i < level.len() {
            let left = level[i];
            let right = if i + 1 < level.len() { level[i + 1] } else { level[i] };
            next.push(node_hash(&left, &right));
            i += 2;
        }
        level = next;
    }
    level[0]
}

fn main() {
    let inputs: CounterfactualInputs = env::read();

    assert!(!inputs.deltas.is_empty(), "empty delta set");

    let mut sum = [0u8; 32];
    for d in &inputs.deltas {
        sum = add_twos_complement_be(&sum, &d.delta_wei_be);
    }
    assert_eq!(sum, inputs.claimed_delta_wei_be, "delta sum mismatch");

    let leaves: Vec<[u8; 32]> = inputs
        .deltas
        .iter()
        .map(|d| leaf_hash(&d.key, &d.delta_wei_be))
        .collect();
    let root = merkle_root(&leaves);

    let journal = counterfactual_journal(
        &inputs.event_id,
        &root,
        &inputs.claimed_delta_wei_be,
        &inputs.victim_protocol,
        &inputs.fork_block_hash,
    );
    env::commit_slice(&journal);
}
