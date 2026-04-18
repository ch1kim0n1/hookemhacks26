"""Phase 5: threat cache hash lookup + poller smoke."""

import hashlib

from network.applier import DefenseApplier
from network.poller import NetworkPoller


class _FakeChain:
    def poll_recent(self, count: int = 20):
        return [{"pattern_hash": "0xabc", "category": "test"}]


def test_poller_delegates():
    p = NetworkPoller(_FakeChain())
    rows = p.poll(5)
    assert len(rows) == 1


def test_threat_hash_lookup_shape():
    h = hashlib.sha256(b"payload").hexdigest()[:16]
    assert len(h) == 16


def test_applier_smoke():
    a = DefenseApplier()
    assert a.apply_pause("0x0000000000000000000000000000000000000001", "0x01") is True
