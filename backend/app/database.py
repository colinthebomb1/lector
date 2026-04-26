import asyncio
import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure
from app.config import get_settings

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


async def _ensure_user_indexes(db: AsyncIOMotorDatabase) -> None:
    await db.users.create_index("session_id", unique=True)
    await db.users.create_index(
        "email",
        unique=True,
        partialFilterExpression={"email": {"$type": "string"}},
    )

    try:
        await db.users.create_index(
            "google_sub",
            unique=True,
            partialFilterExpression={"google_sub": {"$type": "string"}},
        )
    except OperationFailure as exc:
        if exc.code != 86:
            raise
        await db.users.drop_index("google_sub_1")
        await db.users.create_index(
            "google_sub",
            unique=True,
            partialFilterExpression={"google_sub": {"$type": "string"}},
        )


async def connect_db() -> None:
    global _client, _db
    settings = get_settings()
    _client = AsyncIOMotorClient(
        settings.mongo_url,
        serverSelectionTimeoutMS=15000,
    )
    _db = _client[settings.mongo_db]

    try:
        await asyncio.wait_for(_client.admin.command("ping"), timeout=15)
        logger.info("MongoDB connected at %s", settings.mongo_url)
        await _ensure_user_indexes(_db)
        try:
            await _db.submissions.drop_index("user_id_1_challenge_id_1")
        except OperationFailure:
            pass
        await _db.submissions.create_index("created_at")
        await _db.submissions.create_index(
            [("user_id", 1), ("challenge_id", 1), ("created_at", -1)]
        )
        await _db.attack_payloads.create_index(
            [("user_id", 1), ("challenge_id", 1), ("timestamp", -1)]
        )
        await _db.gemma_cache.create_index("created_at", expireAfterSeconds=604800)
    except Exception:
        _client = None
        _db = None
        logger.exception("MongoDB connection failed during startup")
        raise


async def close_db() -> None:
    global _client, _db
    if _client:
        _client.close()
    _client = None
    _db = None


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Database unavailable")
    return _db


def is_db_connected() -> bool:
    return _db is not None
