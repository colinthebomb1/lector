from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.services.challenge_loader import get_challenge
from app.services.gemma import (
    generate_code_review_hint,
    get_hint,
    grade_explanation,
    generate_post_solve_writeup,
)
from app.routers.auth import require_session
from app.database import get_db

router = APIRouter(prefix="/api/gemma", tags=["gemma"])


class HintRequest(BaseModel):
    challenge_id: str
    tier: int = Field(ge=1, le=3)


class ExplanationGradeRequest(BaseModel):
    challenge_id: str
    explanation: str


class WriteupRequest(BaseModel):
    challenge_id: str
    fix_patch: str


class CodeReviewHintRequest(BaseModel):
    challenge_id: str
    challenge_name: str
    challenge_prompt: str
    language: str
    starter_code: str
    current_code: str
    rubric_items: list[str] = Field(default_factory=list)
    static_hints: list[str] = Field(default_factory=list)
    prior_hints: list[str] = Field(default_factory=list)


@router.post("/hint")
async def request_hint(body: HintRequest, user: dict = Depends(require_session)):
    """Get a progressive hint for a challenge (tier 1-3)."""
    challenge = get_challenge(body.challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    db = get_db()
    past = db.submissions.find(
        {"user_id": user["session_id"], "challenge_id": body.challenge_id}
    ).sort("created_at", -1).limit(5)

    user_context = ""
    async for sub in past:
        user_context += f"- {sub.get('submission_type')}: {sub.get('payload', {})}\n"

    hint = await get_hint(body.challenge_id, body.tier, user_context)
    return {"tier": body.tier, "hint": hint}


@router.post("/code-review-hint")
async def request_code_review_hint(
    body: CodeReviewHintRequest, user: dict = Depends(require_session)
):
    """Generate an adaptive AI hint for a code-review challenge."""
    del user  # Session requirement still applies; request body carries challenge context.

    try:
        result = await generate_code_review_hint(
            challenge_name=body.challenge_name,
            challenge_prompt=body.challenge_prompt,
            language=body.language,
            starter_code=body.starter_code,
            current_code=body.current_code,
            rubric_items=body.rubric_items,
            static_hints=body.static_hints,
            prior_hints=body.prior_hints,
        )
    except Exception as exc:  # pragma: no cover - last-resort guard
        fallback_text = (
            body.static_hints[0]
            if body.static_hints
            else "Take another look at the assumptions this code makes about its inputs."
        )
        return {
            "hint": fallback_text,
            "analysis": f"Hint service unavailable ({exc.__class__.__name__}); showing a fallback hint.",
            "progress": "early",
        }

    return {
        "hint": result.get("hint", result.get("text", "")),
        "analysis": result.get("analysis", ""),
        "progress": result.get("progress", "early"),
    }


@router.post("/grade-explanation")
async def grade_user_explanation(
    body: ExplanationGradeRequest, user: dict = Depends(require_session)
):
    """Grade a free-text explanation against the challenge's rubric."""
    challenge = get_challenge(body.challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    import json
    from pathlib import Path

    rubric = {}
    rubric_path = Path(challenge.base_path) / "rubric.json"
    if rubric_path.exists():
        rubric = json.loads(rubric_path.read_text())

    result = await grade_explanation(body.explanation, rubric, challenge.scenario)
    return result


@router.post("/writeup")
async def get_post_solve_writeup(
    body: WriteupRequest, user: dict = Depends(require_session)
):
    """Generate a personalized post-solve writeup."""
    challenge = get_challenge(body.challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    db = get_db()
    past = db.submissions.find(
        {"user_id": user["session_id"], "challenge_id": body.challenge_id}
    ).sort("created_at", -1)

    attempts = []
    async for sub in past:
        attempts.append(str(sub.get("payload", {})))

    writeup = await generate_post_solve_writeup(
        challenge.scenario, attempts, body.fix_patch
    )
    return {"writeup": writeup}
