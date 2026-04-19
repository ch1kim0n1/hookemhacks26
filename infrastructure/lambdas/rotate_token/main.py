"""Secrets Manager rotation Lambda for random bearer tokens.

Implements the four-step rotation handshake Secrets Manager requires:

    createSecret → setSecret → testSecret → finishSecret

For bearer tokens (admin / metrics / ws) "setting" the secret on an external
service is a no-op — the API server reads the token back out of Secrets
Manager on every request, so new material takes effect automatically after
finishSecret flips the AWSCURRENT label. We still implement the full
handshake because Secrets Manager invokes each step explicitly and fails the
rotation if any step raises.

This Lambda has zero dependencies beyond boto3 (provided by the Lambda
runtime), so it ships as a single-file zip — no Docker image required.
"""

from __future__ import annotations

import logging
import os
import secrets
import string

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# 32 url-safe bytes = 256 bits of entropy once hex-encoded. Matches the
# strength Cognito, GitHub PATs, and Stripe rotating keys ship with.
_TOKEN_BYTES = 32
_TOKEN_ALPHABET = string.ascii_letters + string.digits


def lambda_handler(event: dict, _context) -> dict:
    """Entry point called by Secrets Manager on each rotation step."""
    arn = event["SecretId"]
    token = event["ClientRequestToken"]
    step = event["Step"]

    client = _secrets_client()

    metadata = client.describe_secret(SecretId=arn)
    if not metadata.get("RotationEnabled", False):
        logger.error("Rotation not enabled for %s", arn)
        raise ValueError(f"Rotation not enabled for secret {arn}")

    versions = metadata.get("VersionIdsToStages", {})
    if token not in versions:
        logger.error("Token %s has no stage for secret %s", token, arn)
        raise ValueError(f"Secret version {token} has no stage for {arn}")

    if "AWSCURRENT" in versions[token]:
        logger.info("Version %s already AWSCURRENT — nothing to do", token)
        return {"ok": True, "step": step, "noop": True}

    if "AWSPENDING" not in versions[token]:
        logger.error("Version %s not staged as AWSPENDING", token)
        raise ValueError(f"Secret version {token} not staged AWSPENDING")

    dispatch = {
        "createSecret": _create_secret,
        "setSecret": _set_secret,
        "testSecret": _test_secret,
        "finishSecret": _finish_secret,
    }
    handler = dispatch.get(step)
    if handler is None:
        raise ValueError(f"Unknown rotation step: {step}")

    handler(client, arn, token)
    return {"ok": True, "step": step}


def _create_secret(client, arn: str, token: str) -> None:
    """Generate a fresh random token and store it as AWSPENDING."""
    try:
        client.get_secret_value(SecretId=arn, VersionId=token, VersionStage="AWSPENDING")
        logger.info("AWSPENDING version already present for %s — skipping create", arn)
        return
    except client.exceptions.ResourceNotFoundException:
        pass

    fresh = _generate_token()
    client.put_secret_value(
        SecretId=arn,
        ClientRequestToken=token,
        SecretString=fresh,
        VersionStages=["AWSPENDING"],
    )
    logger.info("Wrote new AWSPENDING token for %s", arn)


def _set_secret(_client, arn: str, _token: str) -> None:
    """No-op: the API server reads the token from Secrets Manager directly."""
    logger.info("setSecret is a no-op for bearer tokens on %s", arn)


def _test_secret(client, arn: str, token: str) -> None:
    """Smoke-test that the pending version is readable before promotion."""
    response = client.get_secret_value(
        SecretId=arn, VersionId=token, VersionStage="AWSPENDING"
    )
    value = response.get("SecretString", "")
    if not value or len(value) < 16:
        raise ValueError(f"AWSPENDING secret for {arn} failed sanity check")
    logger.info("AWSPENDING token for %s passed sanity check", arn)


def _finish_secret(client, arn: str, token: str) -> None:
    """Flip AWSCURRENT from the old version to the pending one."""
    metadata = client.describe_secret(SecretId=arn)

    current_version = None
    for version_id, stages in metadata["VersionIdsToStages"].items():
        if "AWSCURRENT" in stages:
            if version_id == token:
                logger.info("Version %s is already current for %s", version_id, arn)
                return
            current_version = version_id
            break

    client.update_secret_version_stage(
        SecretId=arn,
        VersionStage="AWSCURRENT",
        MoveToVersionId=token,
        RemoveFromVersionId=current_version,
    )
    logger.info("Promoted %s to AWSCURRENT for %s", token, arn)


def _generate_token() -> str:
    """Cryptographically-random alphanumeric bearer token."""
    return "".join(secrets.choice(_TOKEN_ALPHABET) for _ in range(_TOKEN_BYTES * 2))


def _secrets_client():
    region = os.environ.get("AWS_REGION", "us-east-1")
    return boto3.client("secretsmanager", region_name=region)
