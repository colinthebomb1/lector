"""
Unified grader — shared backbone for both Security and Code Review tracks.

The only difference is what runs after applying the user's patch:
  - Security: replays the original exploit
  - Code Review: runs the bug-exposing tests
"""

import time

from app.models import Challenge, GradeResult, GradeStatus, Track
from app.services.container import get_container_manager, TestResult


async def grade_submission(challenge: Challenge, patch: str) -> GradeResult:
    """
    Grade a patch submission against a challenge.

    1. Spawn a fresh container from the challenge image
    2. Apply the user's patch
    3. Restart the app
    4. Run functional tests (both tracks)
    5. Run track-specific test (exploit replay or bug-exposing tests)
    """
    cm = get_container_manager()
    track = challenge.metadata.track
    start = time.monotonic()

    image_tag = await cm.ensure_challenge_image(
        challenge.metadata.id, challenge.base_path
    )
    container = await cm.spawn_container(image_tag)

    try:
        applied = await cm.apply_patch(container, patch, challenge.base_path)
        if not applied:
            return GradeResult(
                status=GradeStatus.FAILED,
                message="Patch failed to apply. Check your diff format.",
                elapsed_seconds=time.monotonic() - start,
            )

        await cm.restart_app(container)

        functional = await cm.run_test(container, "tests/functional.py", timeout=10)
        if not functional.passed:
            return GradeResult(
                status=GradeStatus.FAILED,
                message=f"You broke the app: {functional.output}",
                functional_passed=False,
                output=functional.output,
                elapsed_seconds=time.monotonic() - start,
            )

        if track == Track.SECURITY:
            return await _grade_security(container, functional, start)
        else:
            return await _grade_code_review(container, functional, start)

    except Exception as e:
        return GradeResult(
            status=GradeStatus.ERROR,
            message=f"Grader error: {str(e)}",
            elapsed_seconds=time.monotonic() - start,
        )
    finally:
        await cm.kill_container(container)


async def _grade_security(
    container, functional: TestResult, start: float
) -> GradeResult:
    cm = get_container_manager()
    exploit = await cm.run_test(container, "tests/exploit.py", timeout=10)

    if exploit.passed:
        return GradeResult(
            status=GradeStatus.FAILED,
            message="Vulnerability still present — the original exploit still works.",
            functional_passed=True,
            track_test_passed=False,
            output=exploit.output,
            elapsed_seconds=time.monotonic() - start,
        )

    return GradeResult(
        status=GradeStatus.PASSED,
        message="Exploit neutralized! Patch is correct.",
        functional_passed=True,
        track_test_passed=True,
        output=exploit.output,
        elapsed_seconds=time.monotonic() - start,
    )


async def _grade_code_review(
    container, functional: TestResult, start: float
) -> GradeResult:
    cm = get_container_manager()
    bug_tests = await cm.run_test(container, "tests/bug_tests.py", timeout=10)

    if not bug_tests.passed:
        return GradeResult(
            status=GradeStatus.FAILED,
            message=f"Bug still reproducible: {bug_tests.output}",
            functional_passed=True,
            track_test_passed=False,
            output=bug_tests.output,
            elapsed_seconds=time.monotonic() - start,
        )

    return GradeResult(
        status=GradeStatus.PASSED,
        message="Bug fixed! All tests pass.",
        functional_passed=True,
        track_test_passed=True,
        output=bug_tests.output,
        elapsed_seconds=time.monotonic() - start,
    )
