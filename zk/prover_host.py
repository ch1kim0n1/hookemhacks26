"""HTTP stub for a Groth16 prover worker (replace with snarkjs / rapidsnark in production)."""

from __future__ import annotations

import hashlib
import json
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

from .proof_cache import cache_key, get_cached, set_cached

logger = logging.getLogger(__name__)


def _fake_proof(public_inputs: list[str]) -> dict:
    h = hashlib.sha256(json.dumps(public_inputs).encode()).hexdigest()
    return {"proof": f"0x{h}", "publicSignals": public_inputs}


def prove_with_cache(public_inputs: list[str]) -> dict:
    """Return deterministic fake proof, using in-process cache when inputs repeat."""
    key = cache_key(public_inputs)
    hit = get_cached(key)
    if hit is not None:
        return hit
    out = _fake_proof(public_inputs)
    set_cached(key, out)
    return out


class _Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/prove":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body.decode())
            pub = data.get("publicInputs", [])
            out = prove_with_cache(pub)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(out).encode())
        except Exception as e:
            self.send_error(500, str(e))

    def log_message(self, format: str, *args) -> None:
        logger.debug(format, *args)


def serve(host: str = "127.0.0.1", port: int = 9100) -> HTTPServer:
    return HTTPServer((host, port), _Handler)


def start_background(host: str = "127.0.0.1", port: int = 9100) -> tuple[HTTPServer, Thread]:
    httpd = serve(host, port)
    t = Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    logger.info("zk prover stub listening on %s:%s", host, port)
    return httpd, t
