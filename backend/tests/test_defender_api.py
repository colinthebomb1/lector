from types import SimpleNamespace

import pytest

from app import main
from app.models import GradeResult, GradeStatus
from app.routers import auth, submissions


class FakeUsersCollection:
    def __init__(self):
        self.update_calls = []

    async def update_one(self, query, update):
        self.update_calls.append((query, update))
        return SimpleNamespace(matched_count=1)


class FakeSubmissionsCollection:
    def __init__(self):
        self.inserted = []

    async def insert_one(self, doc):
        self.inserted.append(doc)
        return SimpleNamespace(inserted_id=len(self.inserted))


class FakeDatabase:
    def __init__(self):
        self.users = FakeUsersCollection()
        self.submissions = FakeSubmissionsCollection()


@pytest.fixture(autouse=True)
def override_session_dependency():
    main.app.dependency_overrides[auth.require_session] = lambda: {"session_id": "defender-user"}
    yield
    main.app.dependency_overrides.clear()


def test_patch_submission_returns_grade_without_database(client, monkeypatch):
    async def fake_grade_submission(challenge, patch):
        return GradeResult(
            status=GradeStatus.PASSED,
            message="Exploit neutralized! Patch is correct.",
            functional_passed=True,
            track_test_passed=True,
            output="",
            elapsed_seconds=1.2,
        )

    monkeypatch.setattr(submissions, "get_challenge", lambda challenge_id: object())
    monkeypatch.setattr(submissions, "is_db_connected", lambda: False)
    monkeypatch.setattr(submissions, "grade_submission", fake_grade_submission)

    response = client.post(
        "/api/submissions/patch",
        json={"challenge_id": "sqli-login-bypass", "patch": "diff --git a/app.py b/app.py"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "passed"
    assert body["track_test_passed"] is True


def test_patch_submission_records_score_when_database_is_available(client, monkeypatch):
    fake_db = FakeDatabase()

    async def fake_grade_submission(challenge, patch):
        return GradeResult(
            status=GradeStatus.PASSED,
            message="Exploit neutralized! Patch is correct.",
            functional_passed=True,
            track_test_passed=True,
            output="",
            elapsed_seconds=1.2,
        )

    monkeypatch.setattr(submissions, "get_challenge", lambda challenge_id: object())
    monkeypatch.setattr(submissions, "is_db_connected", lambda: True)
    monkeypatch.setattr(submissions, "get_db", lambda: fake_db)
    monkeypatch.setattr(submissions, "grade_submission", fake_grade_submission)

    response = client.post(
        "/api/submissions/patch",
        json={"challenge_id": "sqli-login-bypass", "patch": "diff --git a/app.py b/app.py"},
    )

    assert response.status_code == 200
    assert len(fake_db.submissions.inserted) == 1
    assert fake_db.users.update_calls
