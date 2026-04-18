//! Host-side smoke tests (no full prove — CI installs rzup for guest embed).

use clawguard_zk_host::{
    defense_update_correctness_image_id, image_id_to_bytes32, scan_attestation_image_id,
};

#[test]
fn all_image_ids_are_nonzero() {
    for (name, id) in [
        ("scan-attestation", scan_attestation_image_id()),
        ("defense-update-correctness", defense_update_correctness_image_id()),
    ] {
        assert!(id.iter().any(|&w| w != 0), "{name} image id should be non-zero");
    }
}

#[test]
fn image_ids_are_distinct() {
    let a = scan_attestation_image_id();
    let b = defense_update_correctness_image_id();
    assert_ne!(a, b, "scan-attestation != defense-update-correctness");
}

#[test]
fn image_id_to_bytes32_preserves_limbs_little_endian() {
    // First limb 0x01020304 → first four bytes 04 03 02 01 (little-endian).
    let id = [0x01020304, 0, 0, 0, 0, 0, 0, 0];
    let bytes = image_id_to_bytes32(id);
    assert_eq!(&bytes[0..4], &[0x04, 0x03, 0x02, 0x01]);
    assert!(bytes[4..].iter().all(|&b| b == 0));
}
