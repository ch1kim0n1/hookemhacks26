"""Shared tx feature extraction for ML components.

All models in this service use the same 5-float vector so features
are computed once per tx and passed to both scorers.
"""
from __future__ import annotations

FEATURE_DIM = 5


def extract(tx: dict) -> list[float]:
    """Convert a tx-feature dict to a fixed-length float vector.

    Keys consumed:
        loan_amount_wei (str|int): normalised to [0, 10] (1e21 wei = 1.0)
        price_deviation_pct (float): oracle price deviation percentage
        gas_price_gwei (float): gas price normalised by /100
        is_known_selector (bool): selector matches a known attack 4-byte
        to_is_oracle (bool): tx.to is the oracle pair contract
    """
    loan_raw = tx.get("loan_amount_wei", 0)
    try:
        loan_norm = min(float(str(loan_raw)) / 1e21, 10.0)
    except (ValueError, TypeError):
        loan_norm = 0.0

    return [
        loan_norm,
        float(tx.get("price_deviation_pct", 0.0)),
        float(tx.get("gas_price_gwei", 20.0)) / 100.0,
        float(bool(tx.get("is_known_selector", False))),
        float(bool(tx.get("to_is_oracle", False))),
    ]
