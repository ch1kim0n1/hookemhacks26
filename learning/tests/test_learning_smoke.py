from learning.orchestrator import LearningOrchestrator


def test_orchestrator_run_round():
    o = LearningOrchestrator()
    out = o.run_round("test injection seed")
    assert "blue_score" in out
