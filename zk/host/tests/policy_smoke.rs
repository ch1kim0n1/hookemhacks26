//! Host-side smoke tests (no full prove — CI installs rzup for guest embed).

use sentinel_zk_host::{
    counterfactual_correctness_image_id, image_id_to_bytes32, learning_correctness_image_id,
    policy_compliance_image_id,
};

#[test]
fn all_image_ids_are_nonzero() {
    for (name, id) in [
        ("policy-compliance", policy_compliance_image_id()),
        ("counterfactual-correctness", counterfactual_correctness_image_id()),
        ("learning-correctness", learning_correctness_image_id()),
    ] {
        assert!(id.iter().any(|&w| w != 0), "{name} image id should be non-zero");
    }
}

#[test]
fn image_ids_are_distinct() {
    let a = policy_compliance_image_id();
    let b = counterfactual_correctness_image_id();
    let c = learning_correctness_image_id();
    assert_ne!(a, b, "policy != counterfactual");
    assert_ne!(b, c, "counterfactual != learning");
    assert_ne!(a, c, "policy != learning");
}

#[test]
fn image_id_to_bytes32_preserves_limbs_little_endian() {
    // First limb 0x01020304 → first four bytes 04 03 02 01 (little-endian).
    let id = [0x01020304, 0, 0, 0, 0, 0, 0, 0];
    let bytes = image_id_to_bytes32(id);
    assert_eq!(&bytes[0..4], &[0x04, 0x03, 0x02, 0x01]);
    assert!(bytes[4..].iter().all(|&b| b == 0));
}
