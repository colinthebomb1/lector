from datetime import datetime, timezone

import pytest

from app import main
from app.routers import auth, submissions


class FakeCursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, field, direction):
        reverse = direction == -1
        self.docs = sorted(self.docs, key=lambda doc: doc[field], reverse=reverse)
        return self

    def __aiter__(self):
        self._index = 0
        return self

    async def __anext__(self):
        if self._index >= len(self.docs):
            raise StopAsyncIteration
        doc = dict(self.docs[self._index])
        self._index += 1
        return doc


class FakeSubmissionsCollection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query):
        filtered = [
            doc for doc in self.docs
            if doc["user_id"] == query["user_id"] and doc["challenge_id"] == query["challenge_id"]
        ]
        return FakeCursor(filtered)


class FakeDatabase:
    def __init__(self, docs):
        self.submissions = FakeSubmissionsCollection(docs)


@pytest.fixture(autouse=True)
def override_session_dependency():
    main.app.dependency_overrides[auth.require_session] = lambda: {"session_id": "history-user"}
    yield
    main.app.dependency_overrides.clear()


def test_history_returns_progress_summary(client, monkeypatch):
    docs = [
        {
            "user_id": "history-user",
            "challenge_id": "sqli-login-bypass",
            "submission_type": "patch",
            "phase": "defend",
            "score_awarded": 100,
            "result": {"status": "passed"},
            "payload": {"patch": "fixed"},
            "created_at": datetime(2026, 4, 25, 1, 0, tzinfo=timezone.utc),
        },
        {
            "user_id": "history-user",
            "challenge_id": "sqli-login-bypass",
            "submission_type": "flag",
            "phase": "attack",
            "score_awarded": 50,
            "result": {"status": "passed"},
            "payload": {"flag": "FLAG{sql_injection_is_not_authentication}"},
            "created_at": datetime(2026, 4, 25, 0, 30, tzinfo=timezone.utc),
        },
        {
            "user_id": "history-user",
            "challenge_id": "sqli-login-bypass",
            "submission_type": "summary",
            "phase": "read",
            "score_awarded": 0,
            "result": {"status": "passed"},
            "payload": {"summary": "Reads login inputs and checks credentials."},
            "created_at": datetime(2026, 4, 25, 0, 0, tzinfo=timezone.utc),
        },
    ]

    monkeypatch.setattr(submissions, "is_db_connected", lambda: True)
    monkeypatch.setattr(submissions, "get_db", lambda: FakeDatabase(docs))

    response = client.get("/api/submissions/history/sqli-login-bypass")

    assert response.status_code == 200
    body = response.json()
    assert body["challenge_id"] == "sqli-login-bypass"
    assert body["progress"] == {
        "summary_passed": True,
        "attack_captured": True,
        "defend_passed": True,
        "review_fixed": False,
        "attempt_count": 3,
        "total_score_awarded": 150,
        "last_submission_at": "2026-04-25T01:00:00Z",
    }
    assert [submission["phase"] for submission in body["submissions"]] == [
        "defend",
        "attack",
        "read",
    ]
