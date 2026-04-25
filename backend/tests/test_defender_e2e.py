from pathlib import Path
from unittest.mock import AsyncMock

import docker
import pytest
from fastapi.testclient import TestClient

from app import main
from app.models import Challenge, ChallengeMetadata, Difficulty, Track
from app.routers import auth, submissions

PATCH_FIX = """diff --git a/app.py b/app.py
--- a/app.py
+++ b/app.py
@@ -186,5 +186,5 @@ def login():
     password = request.form.get("password", "")
 
     conn = get_db()
-    query = f"SELECT * FROM users WHERE username='{username}' AND password='{password}'"
-    user = conn.execute(query).fetchone()
+    query = "SELECT * FROM users WHERE username=? AND password=?"
+    user = conn.execute(query, (username, password)).fetchone()
     conn.close()
 
     if user:
"""


def make_real_challenge() -> Challenge:
    base_path = Path(__file__).resolve().parents[1] / "challenges" / "security" / "sqli-login-bypass"
    return Challenge(
        metadata=ChallengeMetadata(
            id="sqli-login-bypass",
            name="SQL Injection: Login Bypass",
            track=Track.SECURITY,
            difficulty=Difficulty.EASY,
            category="injection",
            description="Exploit the login form.",
            estimated_minutes=20,
            flag="FLAG{sql_injection_is_not_authentication}",
        ),
        scenario="Exploit the vulnerable login form.",
        code_files={},
        reference_summary="",
        base_path=str(base_path),
        dockerfile_path=str(base_path / "Dockerfile"),
    )


@pytest.fixture
def defender_client(monkeypatch):
    try:
        docker.from_env().ping()
    except Exception as exc:
        pytest.skip(f"Docker not available for E2E test: {exc}")

    monkeypatch.setattr(main, "connect_db", AsyncMock())
    monkeypatch.setattr(main, "close_db", AsyncMock())
    monkeypatch.setattr(main, "load_challenges", lambda: {})
    monkeypatch.setattr(submissions, "get_challenge", lambda challenge_id: make_real_challenge())
    monkeypatch.setattr(submissions, "is_db_connected", lambda: False)

    main.app.dependency_overrides[auth.require_session] = lambda: {"session_id": "defender-e2e"}
    with TestClient(main.app) as client:
        yield client
    main.app.dependency_overrides.clear()


@pytest.mark.e2e
def test_sqli_defender_patch_grades_successfully(defender_client):
    response = defender_client.post(
        "/api/submissions/patch",
        json={"challenge_id": "sqli-login-bypass", "patch": PATCH_FIX},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "passed"
    assert body["functional_passed"] is True
    assert body["track_test_passed"] is True
    assert "Exploit neutralized" in body["message"]
