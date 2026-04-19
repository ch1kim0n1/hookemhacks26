"""Tests for :mod:`skill.chain.envelope` KMS envelope cipher."""

from __future__ import annotations

import json

import pytest

pytest.importorskip("cryptography")

from skill.chain.envelope import (
    ALGORITHM_LABEL,
    Envelope,
    EnvelopeCipher,
)


class _StubKms:
    """Stub that mimics the two KMS calls the envelope cipher makes."""

    def __init__(self, data_key: bytes = b"\x11" * 32):
        self.data_key = data_key
        self.wrapped = b"WRAPPED:" + data_key
        self.generate_calls = 0
        self.decrypt_calls = 0

    def generate_data_key(self, *, KeyId: str, KeySpec: str):
        self.generate_calls += 1
        assert KeySpec == "AES_256"
        return {
            "Plaintext": self.data_key,
            "CiphertextBlob": self.wrapped,
            "KeyId": KeyId,
        }

    def decrypt(self, *, CiphertextBlob: bytes, KeyId: str):
        self.decrypt_calls += 1
        assert CiphertextBlob == self.wrapped
        return {"Plaintext": self.data_key}


class TestEnvelopeCipher:
    def test_round_trip(self):
        stub = _StubKms()
        cipher = EnvelopeCipher(key_id="arn:aws:kms:test:1:key/e", kms_client=stub)

        env = cipher.encrypt(b"attack signal rule v7")
        assert env.ciphertext != b"attack signal rule v7"
        assert env.algorithm == ALGORITHM_LABEL
        assert len(env.nonce) == 12

        plaintext = cipher.decrypt(env)
        assert plaintext == b"attack signal rule v7"
        assert stub.generate_calls == 1
        assert stub.decrypt_calls == 1

    def test_accepts_string_plaintext(self):
        cipher = EnvelopeCipher(key_id="arn:aws:kms:test:1:key/e", kms_client=_StubKms())
        env = cipher.encrypt("hello")
        assert cipher.decrypt(env) == b"hello"

    def test_json_wire_round_trip(self):
        cipher = EnvelopeCipher(key_id="arn:aws:kms:test:1:key/e", kms_client=_StubKms())
        env = cipher.encrypt(b"payload")
        blob = env.to_json()
        data = json.loads(blob)
        # Wire shape stays stable — downstream nodes depend on these keys.
        assert set(data) == {"alg", "key_id", "wrapped_key", "nonce", "ciphertext"}
        env2 = Envelope.from_json(blob)
        assert env2.wrapped_key == env.wrapped_key
        assert env2.ciphertext == env.ciphertext
        assert env2.nonce == env.nonce

    def test_aad_binds_ciphertext(self):
        cipher = EnvelopeCipher(key_id="arn:aws:kms:test:1:key/e", kms_client=_StubKms())
        env = cipher.encrypt(b"hello", aad=b"node-a")

        with pytest.raises(Exception):  # cryptography raises InvalidTag
            cipher.decrypt(env, aad=b"node-b")

    def test_encrypt_without_key_raises(self, monkeypatch):
        monkeypatch.delenv("CLAWGUARD_ENVELOPE_KMS_KEY_ID", raising=False)
        cipher = EnvelopeCipher(kms_client=_StubKms())
        with pytest.raises(RuntimeError, match="envelope CMK not configured"):
            cipher.encrypt(b"x")

    def test_from_json_rejects_unknown_algorithm(self):
        bad = json.dumps(
            {
                "alg": "AES-128-CBC",
                "key_id": "arn",
                "wrapped_key": "",
                "nonce": "",
                "ciphertext": "",
            }
        )
        with pytest.raises(ValueError, match="unsupported"):
            Envelope.from_json(bad)
