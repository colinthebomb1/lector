from datetime import datetime, timezone
from pydantic import BaseModel, Field


class User(BaseModel):
    session_id: str
    nickname: str = "anonymous"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    challenges_completed: list[str] = []
    total_score: int = 0
