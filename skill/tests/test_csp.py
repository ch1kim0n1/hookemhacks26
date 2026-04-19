"""Content-Security-Policy middleware."""

from fastapi.testclient import TestClient

from skill.api import app

client = TestClient(app)


def test_csp_header_present():
    response = client.get("/api/health")
    assert "content-security-policy" in {k.lower() for k in response.headers.keys()}


def test_csp_header_content():
    response = client.get("/api/health")
    csp_key = next(k for k in response.headers if k.lower() == "content-security-policy")
    csp = response.headers[csp_key].lower()
    assert "default-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp
