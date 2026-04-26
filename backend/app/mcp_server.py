"""
Standalone MCP server exposing the Lector grader to AI agents.

Run from the backend directory:
    python -m app.mcp_server
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.models import GradeResult, Track
from app.services.challenge_loader import get_challenge, list_challenges, load_challenges
from app.services.grader import grade_submission

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as exc:  # pragma: no cover - exercised only without dependency installed
    raise RuntimeError(
        "The MCP SDK is not installed. Install backend requirements first."
    ) from exc


class MCPChallengeSummary(BaseModel):
    id: str
    name: str
    track: Track
    difficulty: str
    category: str
    description: str = ""
    estimated_minutes: int


class VerifyResult(BaseModel):
    challenge_id: str
    challenge_name: str
    track: Track
    status: str
    message: str = ""
    functional_passed: bool | None = None
    track_test_passed: bool | None = None
    output: str = ""
    elapsed_seconds: float = 0.0


mcp = FastMCP("Lector Grader", json_response=True)


def _ensure_challenges_loaded() -> None:
    if not list_challenges():
        load_challenges()


def _challenge_summary(challenge: Any) -> MCPChallengeSummary:
    metadata = challenge.metadata
    return MCPChallengeSummary(
        id=metadata.id,
        name=metadata.name,
        track=metadata.track,
        difficulty=metadata.difficulty.value,
        category=metadata.category,
        description=metadata.description,
        estimated_minutes=metadata.estimated_minutes,
    )


async def verify_patch(challenge_id: str, patch: str) -> VerifyResult:
    """
    Shared implementation for the MCP tool and the CLI wrapper.
    """
    _ensure_challenges_loaded()
    challenge = get_challenge(challenge_id)
    if not challenge:
        raise ValueError(f"Unknown challenge_id: {challenge_id}")

    result: GradeResult = await grade_submission(challenge, patch)
    return VerifyResult(
        challenge_id=challenge.metadata.id,
        challenge_name=challenge.metadata.name,
        track=challenge.metadata.track,
        status=result.status.value,
        message=result.message,
        functional_passed=result.functional_passed,
        track_test_passed=result.track_test_passed,
        output=result.output,
        elapsed_seconds=result.elapsed_seconds,
    )


@mcp.tool()
def list_lector_challenges(track: Track | None = None) -> list[MCPChallengeSummary]:
    """
    List the challenge IDs currently available to the Lector grader.
    """
    _ensure_challenges_loaded()
    challenges = list_challenges()
    if track is not None:
        challenges = [challenge for challenge in challenges if challenge.metadata.track == track]
    return [_challenge_summary(challenge) for challenge in challenges]


@mcp.tool()
async def lector_verify(challenge_id: str, patch: str) -> VerifyResult:
    """
    Grade a proposed patch for a Lector challenge.

    Use the exact challenge ID returned by list_lector_challenges and pass a
    unified diff patch string. For security challenges this replays the exploit;
    for code-review challenges it runs the bug tests.
    """
    return await verify_patch(challenge_id, patch)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
