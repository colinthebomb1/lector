from pathlib import Path
from unittest.mock import AsyncMock

import docker
import pytest
from fastapi.testclient import TestClient

from app import main
from app.models import Challenge, ChallengeMetadata, Difficulty, Track
from app.routers import auth, submissions

def make_patch_fix(base_path: Path) -> str:
    code_dir = base_path / "code"
    vulnerable_block = (
        "    query = f\"SELECT * FROM users WHERE username='{username}' AND password='{password}'\"\n"
        "    user = conn.execute(query).fetchone()\n"
    )
    fixed_block = (
        "    query = \"SELECT * FROM users WHERE username=? AND password=?\"\n"
        "    user = conn.execute(query, (username, password)).fetchone()\n"
    )
    for relative_path in ("app.py", "db.py"):
        target_path = code_dir / relative_path
        if not target_path.exists():
            continue
        original = target_path.read_text(encoding="utf-8")
        updated = original.replace(vulnerable_block, fixed_block, 1)
        if updated == original:
            continue

        old_lines = original.splitlines()
        new_lines = updated.splitlines()
        hunk_lines = "\n".join(
            [*(f"-{line}" for line in old_lines), *(f"+{line}" for line in new_lines)]
        )
        return (
            f"diff --git a/{relative_path} b/{relative_path}\n"
            f"--- a/{relative_path}\n"
            f"+++ b/{relative_path}\n"
            f"@@ -1,{max(len(old_lines), 1)} +1,{max(len(new_lines), 1)} @@\n"
            f"{hunk_lines}\n"
        )

    raise AssertionError("Expected vulnerable SQL query block was not found in app.py or db.py")


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
    base_path = Path(__file__).resolve().parents[1] / "challenges" / "security" / "sqli-login-bypass"
    patch_fix = make_patch_fix(base_path)
    response = defender_client.post(
        "/api/submissions/patch",
        json={"challenge_id": "sqli-login-bypass", "patch": patch_fix},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "passed"
    assert body["functional_passed"] is True
    assert body["track_test_passed"] is True
    assert "Exploit neutralized" in body["message"]
