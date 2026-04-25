from enum import Enum
from pydantic import BaseModel, Field


class Track(str, Enum):
    SECURITY = "security"
    CODE_REVIEW = "code-review"


class Difficulty(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class HintTier(BaseModel):
    tier: int = Field(ge=1, le=3)
    text: str


class ChallengeMetadata(BaseModel):
    id: str
    name: str
    track: Track
    difficulty: Difficulty
    category: str
    description: str = ""
    estimated_minutes: int = 30
    hint_tiers: list[HintTier] = []


class Challenge(BaseModel):
    """Full challenge loaded from disk — metadata + file contents."""

    metadata: ChallengeMetadata
    scenario: str  # markdown scenario text
    code_files: dict[str, str]  # filename -> content
    reference_summary: str = ""
    dockerfile_path: str = ""
    base_path: str = ""  # absolute path on disk to the challenge dir
