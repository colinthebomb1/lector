from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from app.config import get_settings

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


async def connect_db() -> None:
    global _client, _db
    settings = get_settings()
    _client = AsyncIOMotorClient(settings.mongo_url)
    _db = _client[settings.mongo_db]

    await _db.users.create_index("session_id", unique=True)
    await _db.submissions.create_index([("user_id", 1), ("challenge_id", 1)])
    await _db.submissions.create_index("created_at")


async def close_db() -> None:
    global _client, _db
    if _client:
        _client.close()
    _client = None
    _db = None


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("Database not connected — call connect_db() first")
    return _db
