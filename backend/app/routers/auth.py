import uuid

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.database import get_db
from app.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class NicknameRequest(BaseModel):
    nickname: str


@router.post("/session")
async def create_session(response: Response, body: NicknameRequest | None = None):
    """Create an anonymous session with an optional nickname."""
    session_id = str(uuid.uuid4())
    nickname = body.nickname if body else "anonymous"

    user = User(session_id=session_id, nickname=nickname)
    db = get_db()
    await db.users.insert_one(user.model_dump())

    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        samesite="lax",
        max_age=86400,
    )
    return {"session_id": session_id, "nickname": user.nickname}


@router.get("/me")
async def get_current_user(request: Request):
    """Get the current user from session cookie."""
    user = await _get_user_from_request(request)
    if not user:
        return {"authenticated": False}
    return {
        "authenticated": True,
        "nickname": user["nickname"],
        "challenges_completed": user.get("challenges_completed", []),
        "total_score": user.get("total_score", 0),
    }


async def _get_user_from_request(request: Request) -> dict | None:
    session_id = request.cookies.get("session_id")
    if not session_id:
        return None
    db = get_db()
    return await db.users.find_one({"session_id": session_id})


async def require_session(request: Request) -> dict:
    """Dependency: require a valid session, return the user doc."""
    user = await _get_user_from_request(request)
    if not user:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="No active session")
    return user
