"""Tests for MLP sequence detector."""
import pytest
from detector.on_chain.sequence_detector import SequenceDetector


def test_predict_returns_zero_before_training():
    det = SequenceDetector()
    score = det.predict([{"loan_amount_wei": "1000", "is_known_selector": True}])
    assert score == 0.0


def test_trained_marks_fitted():
    det = SequenceDetector()
    det.train(n_attack=50, n_normal=150)
    assert det.trained is True


def test_attack_sequence_scores_high():
    det = SequenceDetector()
    det.train(n_attack=300, n_normal=700)
    attack_seq = [
        {"loan_amount_wei": "900000000000000000000", "price_deviation_pct": 0.0,
         "gas_price_gwei": 30.0, "is_known_selector": False, "to_is_oracle": False},
        {"loan_amount_wei": "0", "price_deviation_pct": 12.5,
         "gas_price_gwei": 35.0, "is_known_selector": False, "to_is_oracle": True},
        {"loan_amount_wei": "0", "price_deviation_pct": 0.0,
         "gas_price_gwei": 30.0, "is_known_selector": False, "to_is_oracle": False},
        {"loan_amount_wei": "0", "price_deviation_pct": 0.0,
         "gas_price_gwei": 30.0, "is_known_selector": False, "to_is_oracle": False},
        {"loan_amount_wei": "0", "price_deviation_pct": 0.0,
         "gas_price_gwei": 50.0, "is_known_selector": True, "to_is_oracle": False},
    ]
    score = det.predict(attack_seq)
    assert score > 0.6, f"Expected high score for attack sequence, got {score}"


def test_normal_sequence_scores_low():
    det = SequenceDetector()
    det.train(n_attack=300, n_normal=700)
    normal_seq = [
        {"loan_amount_wei": "1000000000000000", "price_deviation_pct": 0.05,
         "gas_price_gwei": 18.0, "is_known_selector": False, "to_is_oracle": False},
        {"loan_amount_wei": "2000000000000000", "price_deviation_pct": 0.02,
         "gas_price_gwei": 20.0, "is_known_selector": False, "to_is_oracle": False},
    ]
    score = det.predict(normal_seq)
    assert score < 0.4, f"Expected low score for normal sequence, got {score}"


def test_empty_sequence_returns_zero():
    det = SequenceDetector()
    det.train(n_attack=50, n_normal=150)
    assert det.predict([]) == 0.0


def test_score_is_in_unit_interval():
    det = SequenceDetector()
    det.train(n_attack=100, n_normal=300)
    for txs in [
        [],
        [{}],
        [{"loan_amount_wei": "999999999999999999999999"}] * 10,
    ]:
        s = det.predict(txs)
        assert 0.0 <= s <= 1.0, f"Score out of [0,1]: {s}"
