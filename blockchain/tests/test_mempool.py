"""Tests for mempool monitor feature extraction (port of features.test.ts)."""
from __future__ import annotations

from blockchain.mempool import (
    MonitorConfig,
    build_pending_tx_envelope,
    extract_features,
)


def test_extract_features_basic():
    cfg = MonitorConfig(
        flashLoanProviders={"0xflash"},
        protectedProtocols={"0xvictim"},
    )
    tx = {
        "hash": "0xabc",
        "from": "0xfrom",
        "to": "0xFlash",
        "value": "1000",
        "gasPrice": "1",
        "gas": "21000",
        "nonce": 0,
        "input": "0x12345678deadbeef",
    }
    f = extract_features(tx, cfg)
    assert f.selector == "0x12345678"
    assert f.isFlashLoanOrigin is True
    assert f.involvesProtectedProtocol is False


def test_build_pending_envelope_schema():
    cfg = MonitorConfig(flashLoanProviders=set(), protectedProtocols=set())
    tx = {
        "hash": "0xh",
        "from": "0xf",
        "to": "",
        "value": "0",
        "gasPrice": "0",
        "gas": "21000",
        "nonce": 0,
        "input": "0x",
    }
    f = extract_features(tx, cfg)
    env = build_pending_tx_envelope(f)
    assert env["schema"] == "PendingTxEvent@1"
    assert "observedAt" in env
    assert env["tx"]["from"] == "0xf"
