from fastapi import APIRouter, Query

from app.database import get_db

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])


@router.get("")
async def get_leaderboard(limit: int = Query(default=50, le=100)):
    """Get top users by score."""
    db = get_db()
    cursor = db.users.find(
        {"total_score": {"$gt": 0}},
        {"_id": 0, "session_id": 0},
    ).sort("total_score", -1).limit(limit)

    entries = []
    async for user in cursor:
        entries.append({
            "nickname": user.get("nickname", "anonymous"),
            "total_score": user.get("total_score", 0),
            "challenges_completed": len(user.get("challenges_completed", [])),
        })
    return entries
