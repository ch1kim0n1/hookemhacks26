"""Unified ZK prover gateway — bridges the Rust RISC Zero host to Python.

Three operating modes controlled by `CLAWGUARD_ZK_MODE`:

* ``real``  — invoke the `prove_scan` / `prove_defense_update` Rust binaries
              under `zk/host/target/release/`. Requires `cargo build --release`
              in the `zk/` workspace and RISC Zero toolchain.
* ``mock``  — deterministic SHA-256 proof (dev/demo only).
* ``auto``  — try real, fall back to mock if binary missing (default).

All modes share the same :func:`prove_scan` / :func:`prove_defense_update`
surface, return the same dict shape, and use the in-memory proof cache so
identical public inputs don't trigger re-proving.

Pre-warming:
    :func:`prewarm` generates a proof for a canonical "benign" input pair
    on startup so the JIT / caches are hot before the first real request.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from .proof_cache import cache_key, get_cached, set_cached

logger = logging.getLogger(__name__)

_ZK_ROOT = Path(__file__).resolve().parent
_HOST_BIN_DIR = _ZK_ROOT / "host" / "target" / "release"
_SCAN_BIN = _HOST_BIN_DIR / "prove_scan"
_DEFENSE_BIN = _HOST_BIN_DIR / "prove_defense_update"

_PROVER_LOCK = threading.Lock()
_PREWARM_DONE = threading.Event()


def _mode() -> str:
    return os.environ.get("CLAWGUARD_ZK_MODE", "auto").lower()


def _binary_available(path: Path) -> bool:
    return path.is_file() and os.access(path, os.X_OK)


def _mock_proof(circuit: str, public_inputs: list[str]) -> dict[str, Any]:
    """Deterministic fake proof for dev/test."""
    digest = hashlib.sha256(f"{circuit}:{json.dumps(public_inputs, sort_keys=True)}".encode()).hexdigest()
    return {
        "proof": "0x" + digest,
        "publicInputs": public_inputs,
        "imageId": "0x" + hashlib.sha256(circuit.encode()).hexdigest(),
        "journal": "0x" + "".join(h.removeprefix("0x").rjust(64, "0") for h in public_inputs),
        "elapsedMs": 1,
        "circuit": circuit,
        "_mock": True,
    }


def _run_binary(binary: Path, inputs: dict[str, Any], circuit: str, timeout_s: float) -> dict[str, Any]:
    payload = json.dumps(inputs).encode()
    try:
        proc = subprocess.run(
            [str(binary)],
            input=payload,
            capture_output=True,
            timeout=timeout_s,
            check=True,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{circuit} prover timed out after {timeout_s}s") from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else ""
        raise RuntimeError(f"{circuit} prover failed: {stderr[:500]}") from exc

    try:
        result = json.loads(proc.stdout.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{circuit} prover returned invalid JSON") from exc
    result["_mock"] = False
    return result


def _pub_inputs_for_cache(obj: Any) -> list[str]:
    """Stable list-of-strings for cache-key purposes."""
    if isinstance(obj, list):
        return [str(x) for x in obj]
    if isinstance(obj, dict):
        return [f"{k}={json.dumps(v, sort_keys=True, default=str)}" for k, v in sorted(obj.items())]
    return [str(obj)]


def prove_scan(inputs: dict[str, Any], *, timeout_s: float = 120.0) -> dict[str, Any]:
    """Generate a ScanAttestation proof for a completed detection.

    `inputs` matches the `GuestInputs` struct in `zk/shared/src/lib.rs`.
    Returns a dict with `proof`, `publicInputs`, `imageId`, `journal`, `elapsedMs`.
    """
    key = cache_key(["scan", *_pub_inputs_for_cache(inputs)])
    hit = get_cached(key)
    if hit is not None:
        return hit

    mode = _mode()
    if mode == "mock" or (mode == "auto" and not _binary_available(_SCAN_BIN)):
        if mode == "auto":
            logger.info("zk.prove_scan: real binary not found, using mock")
        out = _mock_proof("scan-attestation", _pub_inputs_for_cache(inputs))
        set_cached(key, out)
        return out

    with _PROVER_LOCK:
        out = _run_binary(_SCAN_BIN, inputs, "scan-attestation", timeout_s)
    set_cached(key, out)
    return out


def prove_defense_update(inputs: dict[str, Any], *, timeout_s: float = 180.0) -> dict[str, Any]:
    """Generate a DefenseUpdateCorrectness proof after a learning round.

    `inputs` matches the `LearningInputs` struct in `zk/shared/src/lib.rs`.
    """
    key = cache_key(["defense", *_pub_inputs_for_cache(inputs)])
    hit = get_cached(key)
    if hit is not None:
        return hit

    mode = _mode()
    if mode == "mock" or (mode == "auto" and not _binary_available(_DEFENSE_BIN)):
        if mode == "auto":
            logger.info("zk.prove_defense_update: real binary not found, using mock")
        out = _mock_proof("defense-update-correctness", _pub_inputs_for_cache(inputs))
        set_cached(key, out)
        return out

    with _PROVER_LOCK:
        out = _run_binary(_DEFENSE_BIN, inputs, "defense-update-correctness", timeout_s)
    set_cached(key, out)
    return out


def prewarm(*, blocking: bool = False) -> threading.Thread | None:
    """Prime the prover caches with a canonical benign input.

    In `auto`/`real` mode this triggers a real proof on startup so the
    first production request doesn't eat the cold-start cost. In `mock`
    mode this is a no-op (returns instantly).
    """
    if _PREWARM_DONE.is_set():
        return None

    def _work() -> None:
        started = time.time()
        try:
            prove_scan(
                {
                    "evidence": {
                        "pattern": "prewarm",
                        "confidence": 0,
                        "contentHashHex": "00" * 32,
                    },
                    "policyHashHex": "00" * 32,
                    "eventIdHex": "00" * 32,
                }
            )
            prove_defense_update(
                {
                    "oldPolicyHashHex": "00" * 32,
                    "newPolicyHashHex": "00" * 32,
                    "derivedFromAttackHashHex": "00" * 32,
                    "modelDeltaHashHex": "00" * 32,
                    "variantCount": 0,
                }
            )
            logger.info("zk.prewarm complete in %.2fs", time.time() - started)
        except Exception as exc:
            logger.warning("zk.prewarm failed: %s", exc)
        finally:
            _PREWARM_DONE.set()

    thread = threading.Thread(target=_work, name="zk-prewarm", daemon=True)
    thread.start()
    if blocking:
        thread.join()
        return None
    return thread


def is_prewarmed() -> bool:
    return _PREWARM_DONE.is_set()


def mode_description() -> str:
    """Human-readable status — for /health and diagnostics."""
    mode = _mode()
    real_available = _binary_available(_SCAN_BIN) and _binary_available(_DEFENSE_BIN)
    if mode == "mock":
        return "mock (explicit)"
    if mode == "real":
        return "real" if real_available else "real (BINARY MISSING)"
    return "real" if real_available else "mock (auto-fallback)"
