"""
Daily-streak calculation.

A user's streak = the number of consecutive UTC days (ending today, or
yesterday so the streak survives until the user's next attempt) on which
they submitted at least one passing solution.
"""

from datetime import date, datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase


async def current_streak(db: AsyncIOMotorDatabase, session_id: str) -> int:
    cursor = db.submissions.find(
        {"user_id": session_id, "result.status": "passed"},
        {"created_at": 1, "_id": 0},
    ).sort("created_at", -1)

    days: set[date] = set()
    async for doc in cursor:
        created = doc.get("created_at")
        if isinstance(created, datetime):
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            days.add(created.astimezone(timezone.utc).date())

    if not days:
        return 0

    today = datetime.now(timezone.utc).date()
    cursor_day = today if today in days else today - timedelta(days=1)
    if cursor_day not in days:
        return 0

    streak = 0
    while cursor_day in days:
        streak += 1
        cursor_day -= timedelta(days=1)
    return streak
