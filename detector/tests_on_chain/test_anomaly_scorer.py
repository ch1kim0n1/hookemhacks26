"""Tests for IsolationForest anomaly scorer."""
from detection_engine.anomaly_scorer import AnomalyScorer


def test_scorer_returns_zero_before_warmup():
    scorer = AnomalyScorer()
    score = scorer.score({"loan_amount_wei": "1000000000000000000000", "price_deviation_pct": 10.0})
    assert score == 0.0


def test_warmup_marks_fitted():
    scorer = AnomalyScorer()
    scorer.warm_up(n_samples=50)
    assert scorer.fitted is True


def test_normal_tx_scores_low():
    scorer = AnomalyScorer()
    scorer.warm_up(n_samples=200)
    normal_tx = {
        "loan_amount_wei": "1000000000000000",  # 0.001 ETH — tiny
        "price_deviation_pct": 0.1,
        "gas_price_gwei": 20.0,
        "is_known_selector": False,
        "to_is_oracle": False,
    }
    score = scorer.score(normal_tx)
    assert score < 0.5, f"Expected low score for normal tx, got {score}"


def test_attack_tx_scores_high():
    scorer = AnomalyScorer()
    scorer.warm_up(n_samples=200)
    attack_tx = {
        "loan_amount_wei": "900000000000000000000",  # 900 ETH — large
        "price_deviation_pct": 12.0,
        "gas_price_gwei": 80.0,
        "is_known_selector": True,
        "to_is_oracle": True,
    }
    score = scorer.score(attack_tx)
    assert score > 0.5, f"Expected high score for attack tx, got {score}"


def test_score_is_in_unit_interval():
    scorer = AnomalyScorer()
    scorer.warm_up(n_samples=100)
    for tx in [
        {},
        {"loan_amount_wei": "0"},
        {"loan_amount_wei": "99999999999999999999999", "price_deviation_pct": 999.0},
    ]:
        s = scorer.score(tx)
        assert 0.0 <= s <= 1.0, f"Score out of [0,1]: {s}"
