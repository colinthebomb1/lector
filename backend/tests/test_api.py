from types import SimpleNamespace

from app.models import Challenge, ChallengeMetadata, Difficulty, Track
from app.routers import auth, challenges


class FakeUsersCollection:
    def __init__(self):
        self.docs = {}

    async def insert_one(self, doc):
        self.docs[doc["session_id"]] = doc
        return SimpleNamespace(inserted_id=doc["session_id"])

    async def find_one(self, query):
        return self.docs.get(query["session_id"])


class FakeDatabase:
    def __init__(self):
        self.users = FakeUsersCollection()


def make_challenge(
    challenge_id: str,
    *,
    track: Track = Track.SECURITY,
    difficulty: Difficulty = Difficulty.EASY,
    category: str = "web",
) -> Challenge:
    metadata = ChallengeMetadata(
        id=challenge_id,
        name=f"Challenge {challenge_id}",
        track=track,
        difficulty=difficulty,
        category=category,
        description="Test challenge",
        estimated_minutes=20,
    )
    return Challenge(
        metadata=metadata,
        scenario="Read the code carefully.",
        code_files={"app.py": "print('hello')"},
        reference_summary="This file prints hello.",
        base_path=f"/tmp/{challenge_id}",
    )


def test_health_endpoint_reports_status(client, monkeypatch):
    monkeypatch.setattr("app.main.is_db_connected", lambda: True)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "app": "Lector",
        "database": "connected",
    }


def test_challenges_endpoint_filters_by_track(client, monkeypatch):
    monkeypatch.setattr(
        challenges,
        "list_challenges",
        lambda: [
            make_challenge("sec-1", track=Track.SECURITY),
            make_challenge("review-1", track=Track.CODE_REVIEW),
        ],
    )

    response = client.get("/api/challenges", params={"track": "security"})

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == "sec-1"
    assert data[0]["track"] == "security"


def test_challenge_detail_returns_loaded_files(client, monkeypatch):
    challenge = make_challenge("sec-1")
    monkeypatch.setattr(challenges, "get_challenge", lambda challenge_id: challenge)

    response = client.get("/api/challenges/sec-1")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "sec-1"
    assert body["code_files"]["app.py"] == "print('hello')"


def test_create_session_sets_cookie_and_persists_user(client, monkeypatch):
    fake_db = FakeDatabase()
    monkeypatch.setattr(auth, "get_db", lambda: fake_db)

    response = client.post("/api/auth/session", json={"nickname": "colin"})

    assert response.status_code == 200
    body = response.json()
    assert body["nickname"] == "colin"
    assert "session_id" in response.cookies
    assert fake_db.users.docs[body["session_id"]]["nickname"] == "colin"


def test_me_returns_anonymous_without_session(client):
    response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json() == {"authenticated": False}
