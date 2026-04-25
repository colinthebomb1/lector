from fastapi import APIRouter, HTTPException, Query

from app.models import Track, Difficulty
from app.services.challenge_loader import get_challenge, list_challenges

router = APIRouter(prefix="/api/challenges", tags=["challenges"])


@router.get("")
async def get_challenges(
    track: Track | None = None,
    difficulty: Difficulty | None = None,
    category: str | None = None,
):
    """List all challenges, optionally filtered by track/difficulty/category."""
    challenges = list_challenges()

    if track:
        challenges = [c for c in challenges if c.metadata.track == track]
    if difficulty:
        challenges = [c for c in challenges if c.metadata.difficulty == difficulty]
    if category:
        challenges = [c for c in challenges if c.metadata.category == category]

    return [
        {
            "id": c.metadata.id,
            "name": c.metadata.name,
            "track": c.metadata.track,
            "difficulty": c.metadata.difficulty,
            "category": c.metadata.category,
            "description": c.metadata.description,
            "estimated_minutes": c.metadata.estimated_minutes,
        }
        for c in challenges
    ]


@router.get("/{challenge_id}")
async def get_challenge_detail(challenge_id: str):
    """Get full challenge details including code files and scenario."""
    challenge = get_challenge(challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    return {
        "id": challenge.metadata.id,
        "name": challenge.metadata.name,
        "track": challenge.metadata.track,
        "difficulty": challenge.metadata.difficulty,
        "category": challenge.metadata.category,
        "description": challenge.metadata.description,
        "estimated_minutes": challenge.metadata.estimated_minutes,
        "scenario": challenge.scenario,
        "code_files": challenge.code_files,
        "hint_tiers": [h.model_dump() for h in challenge.metadata.hint_tiers],
    }


@router.get("/{challenge_id}/code/{file_path:path}")
async def get_challenge_file(challenge_id: str, file_path: str):
    """Get a single code file from a challenge."""
    challenge = get_challenge(challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    content = challenge.code_files.get(file_path)
    if content is None:
        raise HTTPException(status_code=404, detail="File not found in challenge")

    return {"file": file_path, "content": content}
