from fastapi import APIRouter, Depends, HTTPException

from app.database import get_db
from app.models import (
    PatchSubmission,
    FlagSubmission,
    SummarySubmission,
    AnnotationSubmission,
    Submission,
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
        payload=body.model_dump(),
        result=GradeResult(
            status=GradeStatus.PASSED if result.get("passed") else GradeStatus.FAILED,
            message=result.get("feedback", ""),
        ),
    )
    db = get_db()
    await db.submissions.insert_one(submission.model_dump())

    return {
        "passed": result.get("passed", False),
        "feedback": result.get("feedback", ""),
        "missing_points": result.get("missing_points", []),
    }


@router.post("/flag")
async def submit_flag(body: FlagSubmission, user: dict = Depends(require_session)):
    """Submit a captured flag (security track attack phase)."""
    challenge = get_challenge(body.challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    # TODO: validate flag against expected value in challenge metadata
    return {"accepted": True, "message": "Flag accepted"}


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
        payload=body.model_dump(),
        result=result,
    )
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

    return result.model_dump()


@router.post("/annotation")
async def submit_annotations(
    body: AnnotationSubmission, user: dict = Depends(require_session)
):
    """Submit line annotations + optional fix (code review track)."""
    challenge = get_challenge(body.challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    results = {"annotations_accepted": True}

    if body.fix_patch:
        grade_result = await grade_submission(challenge, body.fix_patch)
        results["grade"] = grade_result.model_dump()

    submission = Submission(
        user_id=user["session_id"],
        challenge_id=body.challenge_id,
        submission_type=SubmissionType.ANNOTATION,
        payload=body.model_dump(),
    )
    db = get_db()
    await db.submissions.insert_one(submission.model_dump())

    return results


@router.get("/history/{challenge_id}")
async def get_submission_history(
    challenge_id: str, user: dict = Depends(require_session)
):
    """Get all submissions for a challenge by the current user."""
    db = get_db()
    cursor = db.submissions.find(
        {"user_id": user["session_id"], "challenge_id": challenge_id}
    ).sort("created_at", -1)

    submissions = []
    async for doc in cursor:
        doc.pop("_id", None)
        submissions.append(doc)
    return submissions
