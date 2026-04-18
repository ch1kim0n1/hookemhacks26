"""Counterfactual simulation — fork Anvil, shadow timeline, Merkle root of balance deltas.

Python port of SENTINEL `counterfactual-sim` (structural; full replay uses local Anvil).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Iterable


def sha256_leaf(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def merkle_root(leaves: Iterable[bytes]) -> bytes:
    layer = list(leaves)
    if not layer:
        return hashlib.sha256(b"").digest()
    while len(layer) > 1:
        if len(layer) % 2 == 1:
            layer.append(layer[-1])
        layer = [hashlib.sha256(layer[i] + layer[i + 1]).digest() for i in range(0, len(layer), 2)]
    return layer[0]


@dataclass
class BalanceDelta:
    account: str
    delta_wei: int


def deltas_to_leaves(deltas: list[BalanceDelta]) -> list[bytes]:
    out: list[bytes] = []
    for d in deltas:
        acc = d.account.lower().removeprefix("0x")
        payload = bytes.fromhex(acc.zfill(40)) + d.delta_wei.to_bytes(32, "big", signed=True)
        out.append(sha256_leaf(payload))
    return out


def compute_counterfactual_root(deltas: list[BalanceDelta]) -> bytes:
    return merkle_root(deltas_to_leaves(deltas))
