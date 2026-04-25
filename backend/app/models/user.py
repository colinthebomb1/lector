from datetime import datetime, timezone
from pydantic import BaseModel, Field


class User(BaseModel):
    session_id: str
    nickname: str = "anonymous"
    name: str | None = None
    email: str | None = None
    password_hash: str | None = None
    auth_provider: str = "password"
    google_sub: str | None = None
    avatar_url: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    challenges_completed: list[str] = []
    total_score: int = 0
