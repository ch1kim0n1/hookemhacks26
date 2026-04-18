"""Mempool monitor — Python port of SENTINEL `mempool-monitor`.

Subscribes to pending txs via WS, extracts features, publishes `PendingTxEvent@1`
to Redis Streams (`sentinel.mempool.pending`).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import redis.asyncio as redis
from web3 import Web3
from store.redis_bus import StreamPublisher

log = logging.getLogger(__name__)

STREAM_MEMPOOL_PENDING = "sentinel.mempool.pending"
STREAM_MEMPOOL_BLOCK = "sentinel.mempool.block"
WS_RECONNECT_MAX_ATTEMPTS = int(os.getenv("WS_RECONNECT_MAX_ATTEMPTS", "5"))


@dataclass
class TxFeatures:
    hash: str
    from_: str  # noqa: A003
    to: str
    value: str
    gasPrice: str
    gasLimit: str
    nonce: int
    selector: str
    decodedArgs: None
    isFlashLoanOrigin: bool
    involvesProtectedProtocol: bool
    callGraphDepth: int
    timestamp: int


@dataclass
class MonitorConfig:
    flashLoanProviders: set[str]
    protectedProtocols: set[str]


def load_monitor_config(addresses_file: str | Path | None = None) -> MonitorConfig:
    path = Path(
        addresses_file
        or os.getenv("ADDRESSES_FILE")
        or Path(__file__).resolve().parents[1] / "config" / "addresses.local.json"
    )
    raw = json.loads(path.read_text())
    lower = lambda s: (s or "").lower()  # noqa: E731
    providers: set[str] = set()
    if raw.get("FlashLoanProvider"):
        providers.add(lower(raw["FlashLoanProvider"]))
    protocols: set[str] = set()
    for k in ("VictimLendingPool", "FlashLoanAttacker"):
        if raw.get(k):
            protocols.add(lower(raw[k]))
    return MonitorConfig(flashLoanProviders=providers, protectedProtocols=protocols)


def extract_features(tx: dict[str, Any], cfg: MonitorConfig) -> TxFeatures:
    to_addr = (tx.get("to") or "") or ""
    to_l = to_addr.lower()
    inp = tx.get("input") or tx.get("data") or "0x"
    if isinstance(inp, bytes):
        inp = "0x" + inp.hex()
    selector = inp[:10] if inp and inp != "0x" else "0x"
    if len(selector) < 10 and inp != "0x" and len(inp) >= 10:
        selector = "0x" + inp[2:10]
    val = tx.get("value", 0)
    if hasattr(val, "to"):
        val_s = str(val)
    else:
        val_s = str(int(val, 16) if isinstance(val, str) and val.startswith("0x") else val)
    gp = tx.get("gasPrice") or tx.get("maxFeePerGas") or 0
    if hasattr(gp, "to"):
        gp_s = str(gp)
    else:
        gp_s = str(int(gp, 16) if isinstance(gp, str) and gp.startswith("0x") else gp)
    gl = tx.get("gas", tx.get("gasLimit", 0))
    if hasattr(gl, "to"):
        gl_s = str(gl)
    else:
        gl_s = str(int(gl, 16) if isinstance(gl, str) and gl.startswith("0x") else gl)
    return TxFeatures(
        hash=tx.get("hash", ""),
        from_=tx.get("from", ""),
        to=to_addr,
        value=val_s,
        gasPrice=gp_s,
        gasLimit=gl_s,
        nonce=int(tx.get("nonce", 0), 16) if isinstance(tx.get("nonce"), str) else int(tx.get("nonce", 0)),
        selector=selector,
        decodedArgs=None,
        isFlashLoanOrigin=to_l in cfg.flashLoanProviders,
        involvesProtectedProtocol=to_l in cfg.protectedProtocols,
        callGraphDepth=1,
        timestamp=int(datetime.now(timezone.utc).timestamp() * 1000),
    )


def build_pending_tx_envelope(features: TxFeatures) -> dict[str, Any]:
    tx = {k: v for k, v in asdict(features).items() if k != "from_"}
    tx["from"] = features.from_
    return {
        "schema": "PendingTxEvent@1",
        "observedAt": datetime.fromtimestamp(features.timestamp / 1000, tz=timezone.utc).isoformat(),
        "tx": tx,
    }


def build_block_envelope(block_number: int) -> dict[str, Any]:
    return {
        "schema": "BlockEvent@1",
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "blockNumber": block_number,
    }


class MempoolMonitor:
    """WS pending subscription + HTTP tx fetch + Redis publish."""

    def __init__(
        self,
        *,
        rpc_url: str | None = None,
        ws_url: str | None = None,
        redis_url: str | None = None,
        addresses_file: str | Path | None = None,
    ) -> None:
        self.rpc_url = rpc_url or os.getenv("RPC_URL", "http://127.0.0.1:8545")
        self.ws_url = ws_url or os.getenv("WS_URL", "ws://127.0.0.1:8545")
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://127.0.0.1:6379")
        self._cfg = load_monitor_config(addresses_file)
        self._w3 = Web3(Web3.HTTPProvider(self.rpc_url))
        self._redis: redis.Redis | None = None
        self._publisher: StreamPublisher | None = None

    async def _ensure_redis(self) -> StreamPublisher:
        if self._publisher is None:
            self._redis = redis.from_url(self.redis_url, decode_responses=True)
            self._publisher = StreamPublisher(self._redis)
        assert self._publisher is not None
        return self._publisher

    async def handle_pending_hash(self, tx_hash: str) -> None:
        pub = await self._ensure_redis()
        try:
            tx = self._w3.eth.get_transaction(tx_hash)
        except Exception as e:  # noqa: BLE001
            log.debug("get_transaction failed for %s: %s", tx_hash, e)
            return
        if tx is None:
            return
        h = tx["hash"]
        txd: dict[str, Any] = {
            "hash": h.hex() if hasattr(h, "hex") else str(h),
            "from": tx.get("from", ""),
            "to": (tx.get("to") or "") or "",
            "value": tx.get("value", 0),
            "gasPrice": tx.get("gasPrice") or tx.get("maxFeePerGas") or 0,
            "gas": tx.get("gas"),
            "nonce": tx.get("nonce", 0),
            "input": tx.get("input") or tx.get("data"),
        }
        features = extract_features(txd, self._cfg)
        payload = build_pending_tx_envelope(features)
        await pub.publish(STREAM_MEMPOOL_PENDING, payload)
        log.info("published pending %s selector=%s", features.hash, features.selector)

    async def run_ws_loop(self) -> None:
        """Subscribe to `newPendingTransactions` via websocket JSON-RPC."""
        import websockets

        pub = await self._ensure_redis()
        attempt = 0
        while attempt < WS_RECONNECT_MAX_ATTEMPTS:
            try:
                async with websockets.connect(self.ws_url) as ws:
                    attempt = 0
                    sub = {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "eth_subscribe",
                        "params": ["newPendingTransactions"],
                    }
                    await ws.send(json.dumps(sub))
                    # subscription ack
                    _ = await ws.recv()
                    while True:
                        raw = await ws.recv()
                        msg = json.loads(raw)
                        params = msg.get("params") or {}
                        result = params.get("result")
                        if isinstance(result, str) and result.startswith("0x") and len(result) == 66:
                            await self.handle_pending_hash(result)
                        elif isinstance(result, dict) and "hash" in result:
                            h = result["hash"]
                            await self.handle_pending_hash(h if isinstance(h, str) else "0x" + bytes(h).hex())
            except Exception as e:  # noqa: BLE001
                attempt += 1
                log.warning("ws loop error (attempt %s): %s", attempt, e)
                await asyncio.sleep(min(2**attempt, 30))

    async def run_block_tick(self) -> None:
        """Optional: poll latest block and publish — simplified one-shot."""
        pub = await self._ensure_redis()
        bn = self._w3.eth.block_number
        await pub.publish(STREAM_MEMPOOL_BLOCK, build_block_envelope(int(bn)))


async def main_async() -> None:
    logging.basicConfig(level=logging.INFO)
    m = MempoolMonitor()
    await m.run_ws_loop()


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
