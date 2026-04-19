"""Authenticated encryption for sensitive protocol material shared with peers.

The L2 ledger is public. This module encrypts *payloads* (rule text, model
deltas, redacted samples) so only holders of ``CLAWGUARD_PROTOCOL_ENCRYPTION_KEY``
can read them. Typical pattern: post a **commitment** (hash) on-chain, move
the ciphertext through IPFS or authenticated peer gossip, decrypt off-chain.

This is **not** wired into ``ChainClient`` or ``publish_defense_update`` yet;
import explicitly when you connect the plumbing.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# AES-256-GCM: 12-byte nonce (IV) is standard for GCM in this codebase.
_NONCE_LEN = 12
_KEY_LEN = 32

_ENV_KEY = "CLAWGUARD_PROTOCOL_ENCRYPTION_KEY"


def load_protocol_encryption_key() -> bytes | None:
    """Return 32-byte key from env, or ``None`` if unset / invalid.

    Env value: standard Base64 (or Base64URL) encoding of 32 raw bytes.
    """
    raw = os.getenv(_ENV_KEY, "").strip()
    if not raw:
        return None
    for decoder in (base64.standard_b64decode, base64.urlsafe_b64decode):
        try:
            key = decoder(raw.encode("ascii"))
        except Exception:
            continue
        if len(key) == _KEY_LEN:
            return key
    return None


def encrypt_protocol_plaintext(plaintext: bytes, *, aad: bytes | None = None) -> dict[str, str]:
    """Encrypt ``plaintext`` with AES-256-GCM.

    Returns a JSON-serializable dict safe to store or transmit beside a chain
    commitment. Fields are Base64 (standard, no padding issues — we use
    ``b64encode`` which pads).

    Raises:
        RuntimeError: if ``CLAWGUARD_PROTOCOL_ENCRYPTION_KEY`` is missing or invalid.
    """
    key = load_protocol_encryption_key()
    if key is None:
        raise RuntimeError(
            f"{_ENV_KEY} must be set to a Base64-encoded 32-byte key "
            "(generate: python -c \"import os,base64; print(base64.b64encode(os.urandom(32)).decode())\")"
        )
    nonce = os.urandom(_NONCE_LEN)
    aes = AESGCM(key)
    aad_bytes = aad if aad is not None else b""
    ciphertext = aes.encrypt(nonce, plaintext, aad_bytes)
    return {
        "v": "1",
        "alg": "AES-256-GCM",
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "aad": base64.b64encode(aad_bytes).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
        "commitment": hashlib.sha256(ciphertext).hexdigest(),
    }


def decrypt_protocol_bundle(bundle: dict[str, Any]) -> bytes:
    """Decrypt a bundle produced by :func:`encrypt_protocol_plaintext`."""
    key = load_protocol_encryption_key()
    if key is None:
        raise RuntimeError(f"{_ENV_KEY} is not set or invalid")
    if bundle.get("alg") != "AES-256-GCM" or bundle.get("v") != "1":
        raise ValueError("unsupported bundle version or algorithm")
    nonce = base64.b64decode(bundle["nonce"])
    aad = base64.b64decode(bundle.get("aad") or b"")
    ciphertext = base64.b64decode(bundle["ciphertext"])
    aes = AESGCM(key)
    return aes.decrypt(nonce, ciphertext, aad)


def encrypt_protocol_dict(data: dict[str, Any], *, aad: bytes | None = None) -> dict[str, str]:
    """JSON-encode ``data`` (sorted keys, compact) and encrypt."""
    payload = json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return encrypt_protocol_plaintext(payload, aad=aad)


def decrypt_protocol_dict(bundle: dict[str, Any]) -> dict[str, Any]:
    """Decrypt and parse JSON object."""
    raw = decrypt_protocol_bundle(bundle)
    return json.loads(raw.decode("utf-8"))


def serialize_publish_payload_for_encryption(payload: dict[str, Any]) -> dict[str, Any]:
    """Convert ``build_publish_payload`` output to JSON-safe primitives (hex strings)."""
    out: dict[str, Any] = {}
    for key, val in payload.items():
        if key == "publicInputs" and isinstance(val, list):
            out[key] = ["0x" + (bytes(x).hex() if not isinstance(x, bytes) else x.hex()) for x in val]
        elif isinstance(val, (bytes, bytearray)):
            out[key] = "0x" + bytes(val).hex()
        else:
            out[key] = val
    return out


def encrypt_defense_publish_bundle(
    publish_payload: dict[str, Any],
    *,
    aad: bytes | None = None,
) -> dict[str, str]:
    """Encrypt a defense publish payload for off-chain relay (IPFS, peers).

    On-chain you might store only a commitment (e.g. sha256 of the ciphertext
    or of the decrypted canonical JSON). The ciphertext itself stays opaque
    to observers without ``CLAWGUARD_PROTOCOL_ENCRYPTION_KEY``.
    """
    serializable = serialize_publish_payload_for_encryption(publish_payload)
    return encrypt_protocol_dict(serializable, aad=aad)


def decrypt_defense_publish_bundle(bundle: dict[str, str]) -> dict[str, Any]:
    """Decrypt bundle from :func:`encrypt_defense_publish_bundle`."""
    return decrypt_protocol_dict(bundle)
