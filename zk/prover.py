"""ZK prover wrapper — invokes Rust `clawguard-zk-host` binaries with SQLite cache."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _proof_cache_db() -> Path:
    return Path(os.getenv("CLAWGUARD_ZK_CACHE", _repo_root() / ".clawguard_zk_cache.db"))


def _cache_key(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


class ZkProver:
    """Spawn `prove_scan` / `prove_defense_update` from the built host binaries."""

    def __init__(self, host_bin_dir: Path | None = None) -> None:
        self._bin_dir = host_bin_dir or (_repo_root() / "zk" / "target" / "release")
        self._db_path = _proof_cache_db()

    def _sqlite_get(self, key: str) -> dict[str, Any] | None:
        conn = sqlite3.connect(self._db_path)
        try:
            row = conn.execute("SELECT seal FROM proofs WHERE k=?", (key,)).fetchone()
            if row:
                return json.loads(row[0])
        finally:
            conn.close()
        return None

    def _sqlite_put(self, key: str, seal_obj: dict[str, Any]) -> None:
        conn = sqlite3.connect(self._db_path)
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS proofs (k TEXT PRIMARY KEY, seal TEXT NOT NULL)"
            )
            conn.execute(
                "INSERT OR REPLACE INTO proofs(k, seal) VALUES (?, ?)",
                (key, json.dumps(seal_obj)),
            )
            conn.commit()
        finally:
            conn.close()

    def _run_binary(self, bin_name: str, stdin_obj: dict[str, Any]) -> dict[str, Any]:
        key = f"{bin_name}:{_cache_key(stdin_obj)}"
        cached = self._sqlite_get(key)
        if cached is not None:
            return cached
        exe = self._bin_dir / bin_name
        if not exe.is_file():
            return {
                "ok": False,
                "error": f"{bin_name} not built: {exe}",
                "hint": "cd zk && cargo build --release -p clawguard-zk-host",
            }
        proc = subprocess.run(
            [str(exe)],
            input=json.dumps(stdin_obj).encode(),
            capture_output=True,
            check=False,
            timeout=600,
        )
        if proc.returncode != 0:
            return {"ok": False, "stderr": proc.stderr.decode()[:2000]}
        out = json.loads(proc.stdout.decode())
        self._sqlite_put(key, out)
        return out

    def prove_scan(self, stdin_obj: dict[str, Any]) -> dict[str, Any]:
        """Run the scan-attestation circuit and return the Groth16 seal envelope."""
        return self._run_binary("prove_scan", stdin_obj)

    def prove_defense_update(self, stdin_obj: dict[str, Any]) -> dict[str, Any]:
        """Run the defense-update-correctness circuit and return the seal envelope."""
        return self._run_binary("prove_defense_update", stdin_obj)
