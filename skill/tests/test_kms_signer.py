"""Tests for :mod:`skill.chain.kms_signer`.

The KMS signer is the core "private key never leaves the HSM" primitive. These
tests exercise the DER / low-s / v-recovery plumbing against a stub boto3
client that returns a deterministic signature produced by coincurve — the only
way to prove the signer works without a live KMS key.
"""

from __future__ import annotations

import hashlib
from typing import Any

import pytest

pytest.importorskip("coincurve")
from coincurve import PrivateKey

from skill.chain.kms_signer import (
    SECP256K1_HALF_N,
    SECP256K1_N,
    KmsSigner,
    SignedTransaction,
    _decode_der_signature,
    _extract_pubkey_bytes,
    _normalize_low_s,
)

# ---------------------------------------------------------------------------
# Deterministic test key — used only in-process; never touches KMS.
# ---------------------------------------------------------------------------


TEST_PRIV = PrivateKey(
    bytes.fromhex("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
)
TEST_PUBKEY_XY: bytes = TEST_PRIV.public_key.format(compressed=False)[1:]


def _spki_blob(pubkey_xy: bytes) -> bytes:
    """Wrap an uncompressed EC point in the SPKI shape KMS actually returns.

    Layout: ``SEQ { SEQ { OID ecPublicKey, OID secp256k1 }, BIT STRING 0x04||X||Y }``.
    We only need the last BIT STRING shape for ``_extract_pubkey_bytes``; the
    preamble can be arbitrary bytes that do not start with the magic BIT STRING
    signature.
    """
    bitstring = b"\x03" + bytes([66]) + b"\x00\x04" + pubkey_xy
    preamble = b"\x30\x10\x06\x07\x2a\x86\x48\xce\x3d\x02\x01\x06\x05\x2b\x81\x04\x00\x0a"
    body = preamble + bitstring
    return b"\x30" + bytes([len(body)]) + body


class _StubKmsClient:
    """Minimal boto3 ``kms`` stub that signs with ``coincurve`` in-process."""

    def __init__(self, private: PrivateKey):
        self._priv = private
        self.calls: list[dict[str, Any]] = []

    def get_public_key(self, KeyId: str) -> dict:
        return {
            "KeyId": "arn:aws:kms:us-east-1:111122223333:key/test-" + KeyId,
            "PublicKey": _spki_blob(self._priv.public_key.format(compressed=False)[1:]),
        }

    def sign(
        self,
        *,
        KeyId: str,
        Message: bytes,
        MessageType: str,
        SigningAlgorithm: str,
    ) -> dict:
        self.calls.append(
            {
                "KeyId": KeyId,
                "MessageType": MessageType,
                "SigningAlgorithm": SigningAlgorithm,
            }
        )
        assert MessageType == "DIGEST"
        assert SigningAlgorithm == "ECDSA_SHA_256"
        assert len(Message) == 32
        sig_der = self._priv.sign(Message, hasher=None)
        return {"Signature": sig_der}


# ---------------------------------------------------------------------------
# Static helpers
# ---------------------------------------------------------------------------


class TestDerDecode:
    def test_roundtrip(self):
        r = 0x1234567890ABCDEF
        s = 0xFEDCBA0987654321
        sig = _make_der(r, s)
        assert _decode_der_signature(sig) == (r, s)

    def test_integer_with_high_bit_needs_leading_zero(self):
        r = 0xF000000000000001
        s = 0x01
        sig = _make_der(r, s)
        decoded_r, decoded_s = _decode_der_signature(sig)
        assert decoded_r == r
        assert decoded_s == s

    def test_wrong_tag_raises(self):
        with pytest.raises(ValueError, match="SEQUENCE"):
            _decode_der_signature(b"\x31\x00")


class TestLowS:
    def test_low_s_unchanged(self):
        assert _normalize_low_s(10) == 10

    def test_high_s_flipped(self):
        high = SECP256K1_HALF_N + 1
        assert _normalize_low_s(high) == SECP256K1_N - high

    def test_half_n_boundary(self):
        # Exactly N/2 is already canonical.
        assert _normalize_low_s(SECP256K1_HALF_N) == SECP256K1_HALF_N


class TestExtractPubkey:
    def test_recovers_xy(self):
        blob = _spki_blob(TEST_PUBKEY_XY)
        assert _extract_pubkey_bytes(blob) == TEST_PUBKEY_XY

    def test_missing_pubkey_raises(self):
        with pytest.raises(ValueError, match="could not locate"):
            _extract_pubkey_bytes(b"\x00" * 30)


# ---------------------------------------------------------------------------
# KmsSigner
# ---------------------------------------------------------------------------


class TestKmsSigner:
    def test_address_stable_across_calls(self):
        stub = _StubKmsClient(TEST_PRIV)
        signer = KmsSigner("alias/test-key", kms_client=stub)
        addr1 = signer.address
        addr2 = signer.address
        assert addr1 == addr2
        assert addr1.startswith("0x") and len(addr1) == 42

    def test_sign_digest_produces_valid_signature(self):
        stub = _StubKmsClient(TEST_PRIV)
        signer = KmsSigner("alias/test-key", kms_client=stub)

        digest = hashlib.sha256(b"hello ClawGuard").digest()
        r, s, v = signer.sign_digest(digest)

        assert s <= SECP256K1_HALF_N, "sig must be low-s normalised"
        assert v in (0, 1)

        # Verify the signature recovers the expected public key.
        from coincurve import PublicKey

        sig65 = r.to_bytes(32, "big") + s.to_bytes(32, "big") + bytes([v])
        recovered = PublicKey.from_signature_and_message(sig65, digest, hasher=None)
        assert recovered.format(compressed=False)[1:] == TEST_PUBKEY_XY

    def test_sign_digest_rejects_wrong_length(self):
        stub = _StubKmsClient(TEST_PRIV)
        signer = KmsSigner("alias/test-key", kms_client=stub)
        with pytest.raises(ValueError, match="32 bytes"):
            signer.sign_digest(b"too short")

    def test_sign_transaction_produces_raw_eip_1559(self):
        stub = _StubKmsClient(TEST_PRIV)
        signer = KmsSigner("alias/test-key", kms_client=stub)

        tx = {
            "chainId": 84532,
            "nonce": 0,
            "maxFeePerGas": 2_000_000_000,
            "maxPriorityFeePerGas": 1_000_000_000,
            "gas": 21000,
            "to": "0x0000000000000000000000000000000000000000",
            "value": 0,
            "data": b"",
        }

        signed = signer.sign_transaction(tx)

        assert isinstance(signed, SignedTransaction)
        assert signed.raw_transaction[0] == 0x02, "EIP-1559 type prefix"
        assert signed.rawTransaction == signed.raw_transaction, "legacy web3 alias"
        assert signed.v in (0, 1)
        assert signed.s <= SECP256K1_HALF_N
        assert len(signed.hash) == 32

    def test_missing_key_id_raises(self):
        with pytest.raises(ValueError):
            KmsSigner("")


def _make_der(r: int, s: int) -> bytes:
    def _encode_int(value: int) -> bytes:
        raw = value.to_bytes((value.bit_length() + 7) // 8 or 1, "big")
        if raw[0] & 0x80:
            raw = b"\x00" + raw
        return b"\x02" + bytes([len(raw)]) + raw

    body = _encode_int(r) + _encode_int(s)
    return b"\x30" + bytes([len(body)]) + body
