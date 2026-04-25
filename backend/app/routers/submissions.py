from fastapi import APIRouter, Depends, HTTPException

from app.database import get_db, is_db_connected
from app.models import (
    PatchSubmission,
    SummarySubmission,
    AnnotationSubmission,
    CodeReviewSubmission,
    Submission,
    SubmissionPhase,
    SubmissionType,
    GradeResult,
    GradeStatus,
)
from app.services.challenge_loader import get_challenge
from app.services.grader import grade_submission
from app.services.gemma import check_reading_comprehension, grade_explanation
from app.routers.auth import require_session

router = APIRouter(prefix="/api/submissions", tags=["submissions"])


@router.post("/summary")
async def submit_summary(body: SummarySubmission, user: dict = Depends(require_session)):
    """Submit a reading comprehension summary for Gemma to evaluate."""
    challenge = get_challenge(body.challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    result = await check_reading_comprehension(body.summary, challenge.reference_summary)

    submission = Submission(
        user_id=user["session_id"],
        challenge_id=body.challenge_id,
        submission_type=SubmissionType.SUMMARY,
        phase=SubmissionPhase.READ,
        payload=body.model_dump(),
        result=GradeResult(
            status=GradeStatus.PASSED if result.get("passed") else GradeStatus.FAILED,
            message=result.get("feedback", ""),
        ),
    )
    if is_db_connected():
        db = get_db()
        await db.submissions.insert_one(submission.model_dump())

    return {
        "passed": result.get("passed", False),
        "feedback": result.get("feedback", ""),
        "missing_points": result.get("missing_points", []),
    }



@router.post("/patch")
async def submit_patch(body: PatchSubmission, user: dict = Depends(require_session)):
    """Submit a patch for grading (both tracks, defend/fix phase)."""
    challenge = get_challenge(body.challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    result = await grade_submission(challenge, body.patch)

    submission = Submission(
        user_id=user["session_id"],
        challenge_id=body.challenge_id,
        submission_type=SubmissionType.PATCH,
        phase=SubmissionPhase.DEFEND,
        payload=body.model_dump(),
        result=result,
    )
    score_awarded = 0
    if is_db_connected():
        db = get_db()
        await db.submissions.insert_one(submission.model_dump())

        if result.status == GradeStatus.PASSED:
            update = await db.users.update_one(
                {
                    "session_id": user["session_id"],
                    "challenges_completed": {"$ne": body.challenge_id},
                },
                {
                    "$addToSet": {"challenges_completed": body.challenge_id},
                    "$inc": {"total_score": 100},
                },
            )
            if update.matched_count == 0:
                await db.users.update_one(
                    {"session_id": user["session_id"]},
                    {"$addToSet": {"challenges_completed": body.challenge_id}},
                )
            else:
                score_awarded = 100

        if score_awarded:
            await db.submissions.update_one(
                {
                    "user_id": user["session_id"],
                    "challenge_id": body.challenge_id,
                    "submission_type": SubmissionType.PATCH,
                    "created_at": submission.created_at,
                },
                {"$set": {"score_awarded": score_awarded}},
            )

    response = result.model_dump()
    response["score_awarded"] = score_awarded
    return response


@router.post("/code-review")
async def submit_code_review(
    body: CodeReviewSubmission, user: dict = Depends(require_session)
):
    """Record a client-graded code-review submission and award points on first pass.

    Code-review challenges are graded entirely on the client (their data
    lives in the frontend bundle), so the server trusts the verdict the
    client reports. Points are only awarded once per challenge per user
    via an atomic `$addToSet` guard, so resubmits do not double-score.
    """
    grade = GradeResult(
        status=GradeStatus.PASSED if body.passed else GradeStatus.FAILED,
        message=body.message,
    )

    submission = Submission(
        user_id=user["session_id"],
        challenge_id=body.challenge_id,
        submission_type=SubmissionType.CODE_REVIEW,
        phase=SubmissionPhase.REVIEW,
        payload=body.model_dump(),
        result=grade,
    )

    score_awarded = 0
    if is_db_connected():
        db = get_db()
        await db.submissions.insert_one(submission.model_dump())

        if body.passed:
            update = await db.users.update_one(
                {
                    "session_id": user["session_id"],
                    "challenges_completed": {"$ne": body.challenge_id},
                },
                {
                    "$addToSet": {"challenges_completed": body.challenge_id},
                    "$inc": {"total_score": 100},
                },
            )
            if update.matched_count == 0:
                # Already complete — make sure the challenge id is present
                # but do not double-score.
                await db.users.update_one(
                    {"session_id": user["session_id"]},
                    {"$addToSet": {"challenges_completed": body.challenge_id}},
                )
            else:
                score_awarded = 100

        if score_awarded:
            await db.submissions.update_one(
                {
                    "user_id": user["session_id"],
                    "challenge_id": body.challenge_id,
                    "submission_type": SubmissionType.CODE_REVIEW,
                    "created_at": submission.created_at,
                },
                {"$set": {"score_awarded": score_awarded}},
            )

    return {
        "passed": body.passed,
        "message": body.message,
        "score_awarded": score_awarded,
    }


@router.post("/annotation")
async def submit_annotations(
    body: AnnotationSubmission, user: dict = Depends(require_session)
):
    """Submit line annotations + optional fix (code review track)."""
    challenge = get_challenge(body.challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    results = {"annotations_accepted": True}
    grade_result = None

    if body.fix_patch:
        grade_result = await grade_submission(challenge, body.fix_patch)
        results["grade"] = grade_result.model_dump()

    submission = Submission(
        user_id=user["session_id"],
        challenge_id=body.challenge_id,
        submission_type=SubmissionType.ANNOTATION,
        phase=SubmissionPhase.REVIEW,
        payload=body.model_dump(),
        result=grade_result,
    )
    if is_db_connected():
        db = get_db()
        await db.submissions.insert_one(submission.model_dump())

    return results


@router.get("/history/{challenge_id}")
async def get_submission_history(
    challenge_id: str, user: dict = Depends(require_session)
):
    """Get a normalized submission timeline plus challenge progress summary."""
    if not is_db_connected():
        return {
            "challenge_id": challenge_id,
            "submissions": [],
            "progress": _build_progress_summary([]),
        }

    db = get_db()
    cursor = db.submissions.find(
        {"user_id": user["session_id"], "challenge_id": challenge_id}
    ).sort("created_at", -1)

    submissions = []
    async for doc in cursor:
        doc.pop("_id", None)
        submissions.append(doc)
    return {
        "challenge_id": challenge_id,
        "submissions": submissions,
        "progress": _build_progress_summary(submissions),
    }


def _build_progress_summary(submissions: list[dict]) -> dict:
    summary_passed = False
    attack_captured = False
    defend_passed = False
    review_fixed = False
    total_score_awarded = 0
    last_submission_at = submissions[0]["created_at"] if submissions else None
    if hasattr(last_submission_at, "isoformat"):
        last_submission_at = last_submission_at.isoformat().replace("+00:00", "Z")

    for submission in submissions:
        result = submission.get("result") or {}
        result_status = result.get("status")
        phase = submission.get("phase")
        score_awarded = submission.get("score_awarded", 0)
        total_score_awarded += score_awarded

        if (
            submission.get("submission_type") == SubmissionType.SUMMARY
            and result_status == GradeStatus.PASSED
        ):
            summary_passed = True
        if phase == SubmissionPhase.ATTACK and result_status == GradeStatus.PASSED:
            attack_captured = True
        if phase == SubmissionPhase.DEFEND and result_status == GradeStatus.PASSED:
            defend_passed = True
        if phase == SubmissionPhase.REVIEW and result_status == GradeStatus.PASSED:
            review_fixed = True

    return {
        "summary_passed": summary_passed,
        "attack_captured": attack_captured,
        "defend_passed": defend_passed,
        "review_fixed": review_fixed,
        "attempt_count": len(submissions),
        "total_score_awarded": total_score_awarded,
        "last_submission_at": last_submission_at,
    }
