"""AWS KMS → EIP-155 signed Ethereum transaction Lambda.

The caller supplies the unsigned transaction (already RLP-encoded) and a chain
id. We hash it with keccak-256, ask KMS to sign the digest, then convert the
KMS ASN.1 DER-encoded signature into Ethereum's (r, s, v) shape and append it
back onto the transaction as a raw signed payload.

The private key never leaves the HSM. This Lambda does not see it at any
point — it only sees the public key (to recover v) and the signature.

Event shape (via API Gateway HTTP API, JSON body):
    {
        "node_id": "a",
        "unsigned_tx_hex": "02f86b...",          # EIP-1559 raw, prefixed 0x02
        "chain_id": 84532,
        "digest_hex": "<keccak256 of unsigned_tx>"   # optional, recomputed if missing
    }

Response:
    {
        "ok": true,
        "r": "0x...", "s": "0x...", "v": 0|1,
        "signature_hex": "0x<64 bytes>",
        "signer_address": "0x...",
        "kms_key_id": "..."
    }
"""

from __future__ import annotations

import hashlib
import json
import logging
import os

import boto3

try:
    # Optional import — present in the Lambda layer we ship. Pure-Python,
    # tiny, maintained by Ethereum Foundation.
    from eth_utils import keccak as _eth_keccak
except ImportError:  # pragma: no cover
    _eth_keccak = None

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())

# secp256k1 curve order. Low-s normalisation rejects sigs whose s is in the
# upper half of [1, N-1] — geth and BIP-62 compliant clients require this.
SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
SECP256K1_HALF_N = SECP256K1_N // 2


def lambda_handler(event: dict, _context) -> dict:
    try:
        body = _parse_body(event)
        node_id = body["node_id"]
        unsigned_tx_hex = body["unsigned_tx_hex"].removeprefix("0x")
        chain_id = int(body["chain_id"])

        digest = _digest(body, unsigned_tx_hex)
        key_alias = _alias_for_node(node_id)

        client = _kms_client()
        key_arn, pubkey_der = _describe_key(client, key_alias)

        sig_der = client.sign(
            KeyId=key_alias,
            Message=digest,
            MessageType="DIGEST",
            SigningAlgorithm="ECDSA_SHA_256",
        )["Signature"]

        r, s = _decode_der_signature(sig_der)
        s = _normalize_low_s(s)

        pubkey_bytes = _extract_pubkey_bytes(pubkey_der)
        signer_address = _address_from_pubkey(pubkey_bytes)
        v = _recover_v(digest, r, s, pubkey_bytes)

        return _json_response(
            200,
            {
                "ok": True,
                "r": _hex32(r),
                "s": _hex32(s),
                "v": v,
                "signer_address": signer_address,
                "kms_key_id": key_arn,
                "chain_id": chain_id,
            },
        )
    except KeyError as exc:
        logger.exception("Missing field")
        return _json_response(400, {"ok": False, "error": f"missing field: {exc.args[0]}"})
    except Exception as exc:  # pragma: no cover - defensive top-level
        logger.exception("sign-tx failed")
        return _json_response(
            500,
            {"ok": False, "error": f"{type(exc).__name__}: {exc}"},
        )


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------


def _parse_body(event: dict) -> dict:
    if "body" not in event:
        return event
    body = event["body"]
    if isinstance(body, str):
        return json.loads(body)
    return body


def _alias_for_node(node_id: str) -> str:
    prefix = os.environ.get("CLAWGUARD_NODE_ALIAS_PREFIX", "clawguard-node")
    return f"alias/{prefix}-{node_id}"


def _kms_client():
    region = os.environ.get("AWS_REGION", "us-east-1")
    return boto3.client("kms", region_name=region)


def _describe_key(client, alias: str) -> tuple[str, bytes]:
    pk = client.get_public_key(KeyId=alias)
    return pk["KeyId"], pk["PublicKey"]


def _digest(body: dict, unsigned_tx_hex: str) -> bytes:
    if body.get("digest_hex"):
        return bytes.fromhex(body["digest_hex"].removeprefix("0x"))
    return _keccak256(bytes.fromhex(unsigned_tx_hex))


def _keccak256(payload: bytes) -> bytes:
    if _eth_keccak is not None:
        return _eth_keccak(payload)
    # pysha3 / hashlib on Python 3.12 — fall back if eth_utils isn't available.
    return hashlib.new("sha3_256", payload).digest()


def _decode_der_signature(sig: bytes) -> tuple[int, int]:
    """Minimal DER parser for secp256k1 (r, s) pairs.

    DER layout (SEQUENCE of two INTEGERs):
        0x30 <seq_len> 0x02 <r_len> <r_bytes> 0x02 <s_len> <s_bytes>
    """
    if sig[0] != 0x30:
        raise ValueError("DER: expected SEQUENCE tag 0x30")
    seq_len = sig[1]
    if seq_len + 2 != len(sig):
        raise ValueError(f"DER: length mismatch {seq_len + 2} vs {len(sig)}")

    if sig[2] != 0x02:
        raise ValueError("DER: expected INTEGER tag for r")
    r_len = sig[3]
    r_bytes = sig[4 : 4 + r_len]

    s_tag_offset = 4 + r_len
    if sig[s_tag_offset] != 0x02:
        raise ValueError("DER: expected INTEGER tag for s")
    s_len = sig[s_tag_offset + 1]
    s_bytes = sig[s_tag_offset + 2 : s_tag_offset + 2 + s_len]

    return int.from_bytes(r_bytes, "big"), int.from_bytes(s_bytes, "big")


def _normalize_low_s(s: int) -> int:
    return SECP256K1_N - s if s > SECP256K1_HALF_N else s


def _extract_pubkey_bytes(spki_der: bytes) -> bytes:
    """Extract the 64-byte uncompressed public key X||Y from a KMS SubjectPublicKeyInfo.

    KMS returns ASN.1 DER SubjectPublicKeyInfo; for secp256k1 the BIT STRING
    payload is an EC point (0x04 || X || Y). We locate the BIT STRING, strip
    its unused-bits byte and the 0x04 uncompressed-form tag.
    """
    # BIT STRING tag is 0x03. Walk backwards from the end of the SPKI: the
    # last BIT STRING of length 66 (1 unused-bits + 1 format byte + 64 point)
    # contains the key.
    for i in range(len(spki_der) - 1, -1, -1):
        if spki_der[i] == 0x03 and i + 2 < len(spki_der):
            bitstr_len = spki_der[i + 1]
            # Expected: 1 unused-bits byte + 1 format (0x04) byte + 64 point bytes = 66
            if bitstr_len == 66 and spki_der[i + 2] == 0x00 and spki_der[i + 3] == 0x04:
                return spki_der[i + 4 : i + 4 + 64]
    raise ValueError("Could not locate uncompressed EC point in SPKI")


def _address_from_pubkey(pubkey_xy: bytes) -> str:
    """Ethereum address = last 20 bytes of keccak256(pubkey_x || pubkey_y)."""
    digest = _keccak256(pubkey_xy)
    return "0x" + digest[-20:].hex()


def _recover_v(digest: bytes, r: int, s: int, expected_pubkey: bytes) -> int:
    """Try v ∈ {0, 1}; whichever recovers the expected pubkey is the answer."""
    try:
        from coincurve import PublicKey
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "coincurve required for v recovery; bundle it in the Lambda zip"
        ) from exc

    for candidate_v in (0, 1):
        sig65 = r.to_bytes(32, "big") + s.to_bytes(32, "big") + bytes([candidate_v])
        try:
            recovered = PublicKey.from_signature_and_message(sig65, digest, hasher=None)
            # from_signature_and_message returns compressed by default; grab
            # uncompressed X||Y to match expected_pubkey shape.
            recovered_xy = recovered.format(compressed=False)[1:]
            if recovered_xy == expected_pubkey:
                return candidate_v
        except Exception:
            continue
    raise RuntimeError("could not recover v — signature/pubkey mismatch")


def _hex32(value: int) -> str:
    return "0x" + value.to_bytes(32, "big").hex()


def _json_response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
