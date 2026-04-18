//! Fixed-point tiny MLP evaluated inside the zkVM guest.
//!
//! Layout: N inputs → M hidden units (ReLU) → 1 output unit → threshold.
//! All arithmetic is i64 with saturating mul/add, no floats, so every
//! Groth16 proof is bit-exact reproducible off-chain. Weights live in
//! `Policy.mlp` (canonical JSON); `policyHash` commits to them so the
//! on-chain verifier is bound to the exact network that ran.
//!
//! `shift_bits` right-shifts each matmul accumulator before the bias
//! is added, rolling the i32×i32→i64 product scale back to the original
//! fixed-point representation. Typical values: 10 (÷1024) for weights
//! trained at ~1024-scale.

#![allow(clippy::many_single_char_names)]

extern crate alloc;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DenseLayer {
    /// Row-major: weights[output_unit][input_unit].
    pub weights: Vec<Vec<i32>>,
    pub biases: Vec<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TinyMlp {
    pub feature_names: Vec<String>,
    pub hidden: DenseLayer,
    pub output: DenseLayer,
    /// Signed threshold on the (scalar) output activation.
    pub threshold: i64,
    /// Right-shift applied after each matmul accumulator before the bias.
    pub shift_bits: u8,
}

fn relu(x: i64) -> i64 {
    if x < 0 {
        0
    } else {
        x
    }
}

/// Evaluate the MLP. Returns the scalar output activation; the caller
/// compares against `threshold`. Returns `None` on dimension mismatch;
/// the guest panics (no proof) in that case.
pub fn forward(mlp: &TinyMlp, features: &[i32]) -> Option<i64> {
    if mlp.hidden.weights.is_empty() || mlp.output.weights.is_empty() {
        return None;
    }
    if mlp.hidden.weights[0].len() != features.len() {
        return None;
    }
    if mlp.hidden.weights.len() != mlp.hidden.biases.len() {
        return None;
    }
    if mlp.output.weights[0].len() != mlp.hidden.weights.len() {
        return None;
    }
    if mlp.output.weights.len() != mlp.output.biases.len() || mlp.output.biases.len() != 1 {
        return None;
    }
    // Every hidden row must have identical length (the input fan-in we verified above).
    for row in mlp.hidden.weights.iter() {
        if row.len() != features.len() {
            return None;
        }
    }

    let shift = mlp.shift_bits as u32;

    let mut hidden_out: Vec<i64> = Vec::with_capacity(mlp.hidden.biases.len());
    for (j, row) in mlp.hidden.weights.iter().enumerate() {
        let mut acc: i64 = 0;
        for (i, w) in row.iter().enumerate() {
            acc = acc.saturating_add((*w as i64).saturating_mul(features[i] as i64));
        }
        let scaled = acc >> shift;
        hidden_out.push(relu(scaled.saturating_add(mlp.hidden.biases[j] as i64)));
    }

    let mut acc: i64 = 0;
    for (j, w) in mlp.output.weights[0].iter().enumerate() {
        acc = acc.saturating_add((*w as i64).saturating_mul(hidden_out[j]));
    }
    let scaled = acc >> shift;
    Some(scaled.saturating_add(mlp.output.biases[0] as i64))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_passing_attack() -> TinyMlp {
        TinyMlp {
            feature_names: alloc::vec![
                String::from("loan"),
                String::from("dev"),
                String::from("depth"),
                String::from("entropy"),
                String::from("hops"),
            ],
            hidden: DenseLayer {
                weights: alloc::vec![alloc::vec![2, 3, 1, 1, 4], alloc::vec![1, 2, 1, 1, 2],],
                biases: alloc::vec![-5000, -3000],
            },
            output: DenseLayer {
                weights: alloc::vec![alloc::vec![3, 2]],
                biases: alloc::vec![-20000],
            },
            threshold: 0,
            shift_bits: 0,
        }
    }

    #[test]
    fn forward_produces_positive_on_attack_features() {
        let mlp = fixture_passing_attack();
        let features = [9500, 8000, 9000, 7500, 200];
        let y = forward(&mlp, &features).expect("dims match");
        assert!(y >= mlp.threshold, "attack must clear threshold: y={}", y);
    }

    #[test]
    fn forward_produces_negative_on_benign_features() {
        let mlp = fixture_passing_attack();
        let features = [500, 200, 100, 50, 0];
        let y = forward(&mlp, &features).expect("dims match");
        assert!(y < mlp.threshold, "benign must fail threshold: y={}", y);
    }

    #[test]
    fn forward_rejects_dim_mismatch() {
        let mlp = fixture_passing_attack();
        assert!(forward(&mlp, &[1, 2, 3]).is_none());
    }

    #[test]
    fn relu_clamps_negatives() {
        assert_eq!(relu(-5), 0);
        assert_eq!(relu(0), 0);
        assert_eq!(relu(42), 42);
    }

    #[test]
    fn forward_saturates_without_panicking_on_extremes() {
        let mlp = TinyMlp {
            feature_names: alloc::vec![String::from("x")],
            hidden: DenseLayer {
                weights: alloc::vec![alloc::vec![i32::MAX]],
                biases: alloc::vec![0],
            },
            output: DenseLayer {
                weights: alloc::vec![alloc::vec![i32::MAX]],
                biases: alloc::vec![0],
            },
            threshold: 0,
            shift_bits: 0,
        };
        let _ = forward(&mlp, &[i32::MAX]);
    }

    #[test]
    fn forward_with_shift_produces_scaled_output() {
        // Same fixture but shift_bits=4 → acc right-shifted by 16 before bias.
        let mut mlp = fixture_passing_attack();
        mlp.shift_bits = 4;
        let features = [9500, 8000, 9000, 7500, 200];
        let y = forward(&mlp, &features).expect("dims match");
        // Output must be finite and the computation must not panic.
        assert!(y.abs() < i64::MAX / 2);
    }
}
