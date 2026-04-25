from app.models import Challenge, ChallengeMetadata, Difficulty, GradeResult, GradeStatus, Track
from app import mcp_server


def make_challenge(challenge_id: str = "sec-1") -> Challenge:
    return Challenge(
        metadata=ChallengeMetadata(
            id=challenge_id,
            name="Security Test",
            track=Track.SECURITY,
            difficulty=Difficulty.EASY,
            category="injection",
            description="Test challenge",
            estimated_minutes=20,
        ),
        scenario="scenario",
        code_files={"app.py": "print('hi')"},
        reference_summary="summary",
        base_path="/tmp/sec-1",
        dockerfile_path="/tmp/sec-1/Dockerfile",
    )


async def test_verify_patch_returns_structured_result(monkeypatch):
    challenge = make_challenge("sqli-login-bypass")

    monkeypatch.setattr(mcp_server, "list_challenges", lambda: [challenge])
    monkeypatch.setattr(mcp_server, "get_challenge", lambda challenge_id: challenge)

    async def fake_grade_submission(challenge_arg, patch):
        assert challenge_arg.metadata.id == "sqli-login-bypass"
        assert patch == "diff --git a/app.py b/app.py"
        return GradeResult(
            status=GradeStatus.PASSED,
            message="Exploit neutralized! Patch is correct.",
            functional_passed=True,
            track_test_passed=True,
            output="pytest output",
            elapsed_seconds=1.5,
        )

    monkeypatch.setattr(mcp_server, "grade_submission", fake_grade_submission)

    result = await mcp_server.verify_patch(
        "sqli-login-bypass",
        "diff --git a/app.py b/app.py",
    )

    assert result.challenge_id == "sqli-login-bypass"
    assert result.challenge_name == "Security Test"
    assert result.track == Track.SECURITY
    assert result.status == "passed"
    assert result.functional_passed is True
    assert result.track_test_passed is True
    assert result.output == "pytest output"


def test_list_lector_challenges_filters_by_track(monkeypatch):
    security = make_challenge("sec-1")
    review = Challenge(
        metadata=ChallengeMetadata(
            id="review-1",
            name="Review Test",
            track=Track.CODE_REVIEW,
            difficulty=Difficulty.MEDIUM,
            category="logic",
            description="Review challenge",
            estimated_minutes=25,
        ),
        scenario="scenario",
        code_files={"bug.py": "pass"},
        reference_summary="summary",
        base_path="/tmp/review-1",
    )

    monkeypatch.setattr(mcp_server, "list_challenges", lambda: [security, review])

    challenges = mcp_server.list_lector_challenges(Track.SECURITY)

    assert len(challenges) == 1
    assert challenges[0].id == "sec-1"
    assert challenges[0].track == Track.SECURITY


async def test_verify_patch_rejects_unknown_challenge(monkeypatch):
    monkeypatch.setattr(mcp_server, "list_challenges", lambda: [])
    monkeypatch.setattr(mcp_server, "load_challenges", lambda: {})
    monkeypatch.setattr(mcp_server, "get_challenge", lambda challenge_id: None)

    try:
        await mcp_server.verify_patch("missing", "diff --git a/app.py b/app.py")
    except ValueError as exc:
        assert str(exc) == "Unknown challenge_id: missing"
    else:  # pragma: no cover
        raise AssertionError("Expected ValueError for unknown challenge")
