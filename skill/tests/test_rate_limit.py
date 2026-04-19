"""Rate limiting for skill manifest audit routes."""

from fastapi.testclient import TestClient

from skill.api import app, skill_manifest_rate_state

client = TestClient(app)


def test_rate_limit_allows_requests_within_limit():
    skill_manifest_rate_state.clear()
    for _ in range(5):
        response = client.post("/api/skill", json={"manifest": "# test skill md"})
        assert response.status_code != 429


def test_rate_limit_blocks_excess_requests():
    skill_manifest_rate_state.clear()
    last = None
    for _ in range(11):
        last = client.post(
            "/api/skill",
            json={"manifest": "# x"},
            headers={"X-Forwarded-For": "192.168.1.1"},
        )
    assert last is not None
    assert last.status_code == 429
