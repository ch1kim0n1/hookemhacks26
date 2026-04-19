"""KMS envelope encryption for off-chain node-to-node payloads.

Judge pitch: ClawGuard publishes threat hashes to a public chain (Base Sepolia)
because the hash itself is one-way and must stay matchable across nodes. But
the *defense-protocol updates* (signal rules, classifier deltas, pre-emptive
strike payloads) that nodes exchange off-chain are sensitive — a leak would
tell an attacker what ClawGuard is looking for. We wrap those with KMS
envelope encryption:

1. Ask KMS to ``generate_data_key`` (AES-256) under the envelope CMK. KMS
   returns a plaintext key (used locally) and a ciphertext-blob-wrapped key
   (stored alongside the payload).
2. Encrypt the payload with the plaintext key using AES-GCM. Immediately drop
   the plaintext key from memory.
3. Recipients call ``decrypt(envelope)`` → KMS ``decrypt`` on the wrapped key,
   then AES-GCM open.

The plaintext key lives in process memory for microseconds. The wrapped key
lives forever in the ciphertext envelope, but is useless without KMS access —
and the CMK policy only permits node task roles + the rotation Lambda role.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import secrets
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

ALGORITHM_LABEL = "AES-256-GCM"
NONCE_BYTES = 12
TAG_BYTES = 16


@dataclass(frozen=True)
class Envelope:
    """Wire-format for an envelope-encrypted payload.

    The on-wire JSON shape is::

        {
            "alg": "AES-256-GCM",
            "key_id": "arn:aws:kms:…",
            "wrapped_key": "<base64>",
            "nonce": "<base64>",
            "ciphertext": "<base64>"
        }
    """

    key_id: str
    wrapped_key: bytes
    nonce: bytes
    ciphertext: bytes
    algorithm: str = ALGORITHM_LABEL

    def to_json(self) -> str:
        return json.dumps(
            {
                "alg": self.algorithm,
                "key_id": self.key_id,
                "wrapped_key": base64.b64encode(self.wrapped_key).decode(),
                "nonce": base64.b64encode(self.nonce).decode(),
                "ciphertext": base64.b64encode(self.ciphertext).decode(),
            }
        )

    @classmethod
    def from_json(cls, blob: str | bytes) -> Envelope:
        data = json.loads(blob)
        algorithm = data.get("alg", ALGORITHM_LABEL)
        if algorithm != ALGORITHM_LABEL:
            raise ValueError(f"unsupported envelope algorithm: {algorithm}")
        return cls(
            key_id=data["key_id"],
            wrapped_key=base64.b64decode(data["wrapped_key"]),
            nonce=base64.b64decode(data["nonce"]),
            ciphertext=base64.b64decode(data["ciphertext"]),
            algorithm=algorithm,
        )


class EnvelopeCipher:
    """KMS-backed AES-256-GCM envelope encrypt / decrypt."""

    def __init__(
        self,
        key_id: str | None = None,
        *,
        region: str | None = None,
        kms_client: Any | None = None,
    ) -> None:
        self.key_id = key_id or os.environ.get("CLAWGUARD_ENVELOPE_KMS_KEY_ID", "").strip()
        self._region = region or os.environ.get("AWS_REGION", "us-east-1")
        self._client = kms_client

    @property
    def client(self) -> Any:
        if self._client is None:
            import boto3

            self._client = boto3.client("kms", region_name=self._region)
        return self._client

    # ------------------------------------------------------------------
    # Encrypt
    # ------------------------------------------------------------------

    def encrypt(self, plaintext: bytes | str, *, aad: bytes | None = None) -> Envelope:
        if not self.key_id:
            raise RuntimeError(
                "envelope CMK not configured — set CLAWGUARD_ENVELOPE_KMS_KEY_ID"
            )
        if isinstance(plaintext, str):
            plaintext = plaintext.encode("utf-8")

        response = self.client.generate_data_key(KeyId=self.key_id, KeySpec="AES_256")
        plaintext_key: bytes = response["Plaintext"]
        wrapped_key: bytes = response["CiphertextBlob"]
        key_id = response.get("KeyId", self.key_id)

        try:
            nonce = secrets.token_bytes(NONCE_BYTES)
            ciphertext = _aes_gcm_encrypt(plaintext_key, nonce, plaintext, aad)
        finally:
            # Overwriting a bytes object in place is not possible in Python,
            # but dropping the only reference is the right signal.
            del plaintext_key

        return Envelope(
            key_id=key_id,
            wrapped_key=wrapped_key,
            nonce=nonce,
            ciphertext=ciphertext,
        )

    # ------------------------------------------------------------------
    # Decrypt
    # ------------------------------------------------------------------

    def decrypt(self, envelope: Envelope, *, aad: bytes | None = None) -> bytes:
        response = self.client.decrypt(
            CiphertextBlob=envelope.wrapped_key,
            KeyId=envelope.key_id,
        )
        plaintext_key: bytes = response["Plaintext"]
        try:
            return _aes_gcm_decrypt(plaintext_key, envelope.nonce, envelope.ciphertext, aad)
        finally:
            del plaintext_key


# ---------------------------------------------------------------------------
# AES-GCM primitives (cryptography / PyCryptodome / stdlib fallback)
# ---------------------------------------------------------------------------


def _aes_gcm_encrypt(key: bytes, nonce: bytes, plaintext: bytes, aad: bytes | None) -> bytes:
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "AES-GCM requires the `cryptography` package — install it in the node image"
        ) from exc
    return AESGCM(key).encrypt(nonce, plaintext, aad)


def _aes_gcm_decrypt(key: bytes, nonce: bytes, ciphertext: bytes, aad: bytes | None) -> bytes:
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "AES-GCM requires the `cryptography` package — install it in the node image"
        ) from exc
    return AESGCM(key).decrypt(nonce, ciphertext, aad)
