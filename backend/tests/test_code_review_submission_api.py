from types import SimpleNamespace

import pytest

from app import main
from app.models import GradeResult, GradeStatus
from app.routers import auth, submissions
from app.services.code_review_grader import grade_code_review_submission


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


@pytest.fixture(autouse=True)
def override_session_dependency():
    main.app.dependency_overrides[auth.require_session] = lambda: {
        "session_id": "code-review-user"
    }
    yield
    main.app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_backend_grader_rejects_javascript_syntax_error():
    result = await grade_code_review_submission(
        "code-review-division-factory",
        "javascript",
        (
            "function createDivider(divisor) {\n"
            "  if (typeof divisor !== 'number' || !Number.isFinite(divisor) || divisor === 0) {\n"
            "    throw new Error('bad divisor');\n"
            "  }\n"
            "  return function divide(value) {\n"
            "    if (typeof value !== 'number' || !Number.isFinite(value)) {\n"
            "      throw new Error('bad value');\n"
            "    }\n"
            "    return value / divisor;\n"
            "  };\n"
            "}\n"
            "random trailing text\n"
        ),
    )

    assert result.status == GradeStatus.ERROR
    assert "compilation error" in result.message.lower()


@pytest.mark.asyncio
async def test_backend_grader_rejects_behavior_that_local_rubric_can_miss():
    result = await grade_code_review_submission(
        "code-review-division-factory",
        "javascript",
        (
            "function createDivider(divisor) {\n"
            "  if (divisor === 0) {\n"
            "    throw new Error('bad divisor');\n"
            "  }\n"
            "  return function divide(value) {\n"
            "    if (typeof value !== 'number' || Number.isNaN(value)) {\n"
            "      throw new Error('bad value');\n"
            "    }\n"
            "    return value / divisor;\n"
            "  };\n"
            "}\n"
        ),
    )

    assert result.status == GradeStatus.FAILED
    assert "test fail" in result.message.lower()
    assert "non-number divisors" in result.message.lower()


@pytest.mark.asyncio
async def test_backend_grader_accepts_valid_javascript_division_factory():
    result = await grade_code_review_submission(
        "code-review-division-factory",
        "javascript",
        (
            "function createDivider(divisor) {\n"
            "  if (typeof divisor !== 'number' || !Number.isFinite(divisor) || divisor === 0) {\n"
            "    throw new Error('bad divisor');\n"
            "  }\n"
            "  return function divide(value) {\n"
            "    if (typeof value !== 'number' || !Number.isFinite(value)) {\n"
            "      throw new Error('bad value');\n"
            "    }\n"
            "    return value / divisor;\n"
            "  };\n"
            "}\n"
        ),
    )

    assert result.status == GradeStatus.PASSED


@pytest.mark.asyncio
async def test_backend_grader_accepts_valid_python_division_factory_without_indent_errors():
    result = await grade_code_review_submission(
        "code-review-division-factory",
        "python",
        (
            "def create_divider(divisor):\n"
            "    if not isinstance(divisor, (int, float)) or isinstance(divisor, bool):\n"
            "        raise TypeError(\"Divisor must be a valid number.\")\n"
            "\n"
            "    if divisor == 0:\n"
            "        raise ValueError(\"Cannot divide by zero.\")\n"
            "\n"
            "    def divide(value):\n"
            "        if not isinstance(value, (int, float)) or isinstance(value, bool):\n"
            "            raise TypeError(\"Value must be a valid number.\")\n"
            "\n"
            "        return value / divisor\n"
            "\n"
            "    return divide\n"
            "\n"
            "\n"
            "def safe_run(label, callback):\n"
            "    try:\n"
            "        print(label, callback())\n"
            "    except (TypeError, ValueError) as error:\n"
            "        print(label, error)\n"
            "\n"
            "\n"
            "safe_run(\"half('ten'):\", lambda: create_divider(2)(\"ten\"))\n"
            "safe_run(\"broken(5):\", lambda: create_divider(False)(5))\n"
        ),
    )

    assert result.status == GradeStatus.PASSED


def test_code_review_submission_route_uses_backend_grade(client, monkeypatch):
    fake_db = FakeDatabase()

    async def fake_grade_code_review_submission(challenge_id, language, code):
        return GradeResult(
            status=GradeStatus.ERROR,
            message="JavaScript compilation error:\nUnexpected identifier",
            output="Unexpected identifier",
        )

    monkeypatch.setattr(submissions, "is_db_connected", lambda: True)
    monkeypatch.setattr(submissions, "get_db", lambda: fake_db)
    monkeypatch.setattr(
        submissions,
        "grade_code_review_submission",
        fake_grade_code_review_submission,
    )

    response = client.post(
        "/api/submissions/code-review",
        json={
            "challenge_id": "code-review-division-factory",
            "language": "javascript",
            "code": "function createDivider() {} trailing",
            "passed": True,
            "message": "client thought this passed",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["passed"] is False
    assert body["status"] == "error"
    assert "compilation error" in body["message"].lower()
    assert body["score_awarded"] == 0
    assert len(fake_db.submissions.inserted) == 1
    assert not fake_db.users.update_calls


def test_code_review_submission_route_awards_score_on_backend_pass(client, monkeypatch):
    fake_db = FakeDatabase()

    async def fake_grade_code_review_submission(challenge_id, language, code):
        return GradeResult(
            status=GradeStatus.PASSED,
            message="Backend verification passed.",
            track_test_passed=True,
        )

    monkeypatch.setattr(submissions, "is_db_connected", lambda: True)
    monkeypatch.setattr(submissions, "get_db", lambda: fake_db)
    monkeypatch.setattr(
        submissions,
        "grade_code_review_submission",
        fake_grade_code_review_submission,
    )

    response = client.post(
        "/api/submissions/code-review",
        json={
            "challenge_id": "code-review-division-factory",
            "language": "javascript",
            "code": "function createDivider() {}",
            "passed": True,
            "message": "client thought this passed",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["passed"] is True
    assert body["status"] == "passed"
    assert body["score_awarded"] == 100
    assert fake_db.users.update_calls
    assert fake_db.submissions.updated[0][1]["$set"]["score_awarded"] == 100
