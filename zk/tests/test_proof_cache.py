"""Proof cache + prover stub."""

from zk.proof_cache import cache_key, get_cached, set_cached
from zk.prover_host import prove_with_cache


def test_cache_key_stable():
    a = cache_key(["0x01", "0x02"])
    b = cache_key(["0x01", "0x02"])
    assert a == b


def test_get_set_cached():
    k = "abc123"
    assert get_cached(k) is None
    set_cached(k, {"proof": "0x1"})
    assert get_cached(k) == {"proof": "0x1"}


def test_prove_with_cache_dedupes():
    a = prove_with_cache(["a", "b"])
    b = prove_with_cache(["a", "b"])
    assert a == b
