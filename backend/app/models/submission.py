from datetime import datetime, timezone
from enum import Enum
from pydantic import BaseModel, Field


class SubmissionType(str, Enum):
    SUMMARY = "summary"
    FLAG = "flag"
    PATCH = "patch"
    ANNOTATION = "annotation"
    CODE_REVIEW = "code_review"


class SubmissionPhase(str, Enum):
    READ = "read"
    ATTACK = "attack"
    DEFEND = "defend"
    REVIEW = "review"


class GradeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    ERROR = "error"


class GradeResult(BaseModel):
    status: GradeStatus
    message: str = ""
    functional_passed: bool | None = None
    track_test_passed: bool | None = None
    output: str = ""
    elapsed_seconds: float = 0.0


class Annotation(BaseModel):
    file: str
    start_line: int
    end_line: int
    category: str  # e.g. "race condition", "off-by-one", "logic error"
    explanation: str


class SummarySubmission(BaseModel):
    challenge_id: str
    summary: str


class FlagSubmission(BaseModel):
    challenge_id: str
    flag: str


class PatchSubmission(BaseModel):
    challenge_id: str
    patch: str  # unified diff or full file replacement


class AnnotationSubmission(BaseModel):
    challenge_id: str
    annotations: list[Annotation]
    fix_patch: str = ""  # optional fix


class CodeReviewSubmission(BaseModel):
    """Code-review submission sent to the backend validator."""

    challenge_id: str
    language: str
    code: str
    passed: bool
    message: str = ""


class Submission(BaseModel):
    """Stored submission record in MongoDB."""

    user_id: str
    challenge_id: str
    submission_type: SubmissionType
    phase: SubmissionPhase
    payload: dict  # the raw submission data
    result: GradeResult | None = None
    score_awarded: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
