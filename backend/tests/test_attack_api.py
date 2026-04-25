from types import SimpleNamespace
from datetime import datetime, timezone

import pytest

from app import main
from app.models import Challenge, ChallengeMetadata, Difficulty, GradeStatus, Track
from app.routers import attack, auth


class FakeUsersCollection:
    def __init__(self):
        self.update_calls = []

    async def update_one(self, query, update):
        self.update_calls.append((query, update))
        return SimpleNamespace(matched_count=1)


class FakeSubmissionsCollection:
    def __init__(self):
        self.inserted = []
        self.updated = []

    async def insert_one(self, doc):
        self.inserted.append(doc)
        return SimpleNamespace(inserted_id=len(self.inserted))

    async def update_one(self, query, update):
        self.updated.append((query, update))
        return SimpleNamespace(matched_count=1)


class FakeDatabase:
    def __init__(self):
        self.users = FakeUsersCollection()
        self.submissions = FakeSubmissionsCollection()
        self.attack_payloads = FakeAttackPayloadsCollection()


class FakePayloadCursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction):
        reverse = direction == -1
        self.docs = sorted(self.docs, key=lambda doc: doc[key], reverse=reverse)
        return self

    async def to_list(self, length):
        if length is None:
            return list(self.docs)
        return list(self.docs[:length])


class FakeAttackPayloadsCollection:
    def __init__(self):
        self.inserted = []

    async def insert_one(self, doc):
        self.inserted.append(doc)
        return SimpleNamespace(inserted_id=len(self.inserted))

    def find(self, query):
        matches = [
            doc for doc in self.inserted
            if doc["user_id"] == query["user_id"] and doc["challenge_id"] == query["challenge_id"]
        ]
        return FakePayloadCursor(matches)


class FakeProxyResponse:
    def __init__(self, status_code=200, text="", headers=None):
        self.status_code = status_code
        self.text = text
        self.content = text.encode()
        self.headers = headers or {"content-type": "text/html"}


class FakeAsyncClient:
    def __init__(self, response):
        self.response = response
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def request(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def make_challenge(flag="FLAG{sql_injection_is_not_authentication}") -> Challenge:
    return Challenge(
        metadata=ChallengeMetadata(
            id="sqli-login-bypass",
            name="SQL Injection: Login Bypass",
            track=Track.SECURITY,
            difficulty=Difficulty.EASY,
            category="injection",
            description="Exploit the login form.",
            estimated_minutes=20,
            flag=flag,
        ),
        scenario="Exploit the vulnerable login form.",
        code_files={"app.py": "print('hello')"},
        reference_summary="The app handles login and admin access.",
        base_path="/tmp/sqli-login-bypass",
    )


@pytest.fixture(autouse=True)
def override_session_dependency():
    main.app.dependency_overrides[auth.require_session] = lambda: {"session_id": "user-1"}
    yield
    main.app.dependency_overrides.clear()


def test_start_attack_returns_proxy_metadata(client, monkeypatch):
    async def fake_start_attack_session(**kwargs):
        return SimpleNamespace(port=5050)

    monkeypatch.setattr(attack, "get_challenge", lambda challenge_id: make_challenge())
    monkeypatch.setattr(attack, "start_attack_session", fake_start_attack_session)

    response = client.post("/api/attack/sqli-login-bypass/start")

    assert response.status_code == 200
    assert response.json() == {
        "status": "running",
        "challenge_id": "sqli-login-bypass",
        "port": 5050,
        "proxy_base": "/api/attack/sqli-login-bypass/proxy",
    }


def test_start_attack_requires_existing_challenge(client, monkeypatch):
    monkeypatch.setattr(attack, "get_challenge", lambda challenge_id: None)

    response = client.post("/api/attack/missing/start")

    assert response.status_code == 404
    assert response.json()["detail"] == "Challenge not found"


def test_submit_flag_accepts_correct_flag_and_records_submission(client, monkeypatch):
    fake_db = FakeDatabase()
    monkeypatch.setattr(attack, "get_challenge", lambda challenge_id: make_challenge())
    monkeypatch.setattr(attack, "is_db_connected", lambda: True)
    monkeypatch.setattr(attack, "get_db", lambda: fake_db)

    response = client.post(
        "/api/attack/sqli-login-bypass/flag",
        json={"flag": "FLAG{sql_injection_is_not_authentication}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["accepted"] is True
    assert len(fake_db.submissions.inserted) == 1
    stored = fake_db.submissions.inserted[0]
    assert stored["challenge_id"] == "sqli-login-bypass"
    assert stored["phase"] == "attack"
    assert stored["result"]["status"] == GradeStatus.PASSED
    assert fake_db.users.update_calls[0][1]["$inc"]["total_score"] == 50
    assert fake_db.submissions.updated[0][1]["$set"]["score_awarded"] == 50


def test_submit_flag_rejects_incorrect_flag(client, monkeypatch):
    fake_db = FakeDatabase()
    monkeypatch.setattr(attack, "get_challenge", lambda challenge_id: make_challenge())
    monkeypatch.setattr(attack, "is_db_connected", lambda: True)
    monkeypatch.setattr(attack, "get_db", lambda: fake_db)

    response = client.post(
        "/api/attack/sqli-login-bypass/flag",
        json={"flag": "FLAG{wrong_flag}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["accepted"] is False
    assert fake_db.submissions.inserted[0]["result"]["status"] == GradeStatus.FAILED
    assert fake_db.users.update_calls == []


def test_proxy_returns_404_without_active_session(client, monkeypatch):
    monkeypatch.setattr(attack, "get_attack_session", lambda user_id, challenge_id: None)

    response = client.get("/api/attack/sqli-login-bypass/proxy/login")

    assert response.status_code == 404
    assert "No active attack session" in response.json()["detail"]


def test_proxy_forwards_request_to_container(client, monkeypatch):
    fake_http = FakeAsyncClient(FakeProxyResponse(text="<h1>Acme Corp</h1>"))
    monkeypatch.setattr(
        attack,
        "get_attack_session",
        lambda user_id, challenge_id: SimpleNamespace(port=5005),
    )
    monkeypatch.setattr(attack.httpx, "AsyncClient", lambda **kwargs: fake_http)

    response = client.get("/api/attack/sqli-login-bypass/proxy/login")

    assert response.status_code == 200
    assert "Acme Corp" in response.text
    assert fake_http.calls[0]["url"] == "http://localhost:5005/login"


def test_proxy_persists_payload_attempts_when_database_is_connected(client, monkeypatch):
    fake_db = FakeDatabase()
    fake_http = FakeAsyncClient(FakeProxyResponse(status_code=302, headers={"content-type": "text/html"}))

    monkeypatch.setattr(
        attack,
        "get_attack_session",
        lambda user_id, challenge_id: SimpleNamespace(port=5005),
    )
    monkeypatch.setattr(attack.httpx, "AsyncClient", lambda **kwargs: fake_http)
    monkeypatch.setattr(attack, "is_db_connected", lambda: True)
    monkeypatch.setattr(attack, "get_db", lambda: fake_db)
    recorded = []
    monkeypatch.setattr(
        attack,
        "record_payload",
        lambda user_id, challenge_id, path, method, form_data, response_status: recorded.append(
            (user_id, challenge_id, path, method, form_data, response_status)
        ),
    )

    response = client.post(
        "/api/attack/sqli-login-bypass/proxy/login",
        data={"username": "' OR '1'='1' -- ", "password": "x"},
        headers={"content-type": "application/x-www-form-urlencoded"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert recorded[0][4]["username"] == "' OR '1'='1' -- "
    assert len(fake_db.attack_payloads.inserted) == 1
    stored = fake_db.attack_payloads.inserted[0]
    assert stored["path"] == "login"
    assert stored["method"] == "POST"
    assert stored["form_data"]["username"] == "' OR '1'='1' -- "
    assert stored["response_status"] == 302


def test_payload_history_returns_persisted_attempts_after_session_is_gone(client, monkeypatch):
    fake_db = FakeDatabase()
    fake_db.attack_payloads.inserted = [
        {
            "user_id": "user-1",
            "challenge_id": "sqli-login-bypass",
            "path": "login",
            "method": "POST",
            "form_data": {"username": "' OR '1'='1' -- ", "password": "x"},
            "response_status": 302,
            "timestamp": datetime(2026, 4, 25, 12, 0, 0, tzinfo=timezone.utc),
        }
    ]
    monkeypatch.setattr(attack, "is_db_connected", lambda: True)
    monkeypatch.setattr(attack, "get_db", lambda: fake_db)

    response = client.get("/api/attack/sqli-login-bypass/payloads")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["payloads"][0]["form_data"]["username"] == "' OR '1'='1' -- "
    assert body["payloads"][0]["timestamp"].startswith("2026-04-25T12:00:00")


def test_stop_attack_returns_not_found_without_session(client, monkeypatch):
    async def fake_stop_attack_session(user_id, challenge_id):
        return False

    monkeypatch.setattr(attack, "stop_attack_session", fake_stop_attack_session)

    response = client.post("/api/attack/sqli-login-bypass/stop")

    assert response.status_code == 404
    assert response.json()["detail"] == "No active attack session"
