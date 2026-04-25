import re
import uuid

from fastapi import APIRouter, HTTPException, Request, Response
from passlib.hash import pbkdf2_sha256
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from app.config import get_settings
from app.database import get_db
from app.models import User

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

router = APIRouter(prefix="/api/auth", tags=["auth"])


class NicknameRequest(BaseModel):
    nickname: str


class SignupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    email: str
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("Invalid email format")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return v.strip().lower()


def _set_session_cookie(response: Response, session_id: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        samesite="lax",
        max_age=settings.session_max_age,
    )


@router.post("/session")
async def create_session(response: Response, body: NicknameRequest | None = None):
    """Create an anonymous session with an optional nickname."""
    session_id = str(uuid.uuid4())
    nickname = body.nickname if body else "anonymous"

    user = User(session_id=session_id, nickname=nickname)
    db = get_db()
    await db.users.insert_one(user.model_dump())

    _set_session_cookie(response, session_id)
    return {"session_id": session_id, "nickname": user.nickname}


@router.post("/signup")
async def signup(body: SignupRequest, response: Response):
    """Register a new account with email + password and start a session."""
    db = get_db()
    email = body.email

    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        session_id=str(uuid.uuid4()),
        nickname=body.name,
        name=body.name,
        email=email,
        password_hash=pbkdf2_sha256.hash(body.password),
    )

    try:
        await db.users.insert_one(user.model_dump())
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Email already registered")

    _set_session_cookie(response, user.session_id)
    return {
        "session_id": user.session_id,
        "nickname": user.nickname,
        "email": user.email,
    }


@router.post("/login")
async def login(body: LoginRequest, response: Response):
    """Authenticate an existing user and refresh the session cookie."""
    db = get_db()
    user = await db.users.find_one({"email": body.email})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not pbkdf2_sha256.verify(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    _set_session_cookie(response, user["session_id"])
    return {
        "session_id": user["session_id"],
        "nickname": user.get("nickname", "anonymous"),
        "email": user.get("email"),
    }


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("session_id")
    return {"ok": True}


@router.get("/me")
async def get_current_user(request: Request):
    """Get the current user from session cookie."""
    user = await _get_user_from_request(request)
    if not user:
        return {"authenticated": False}
    return {
        "authenticated": True,
        "nickname": user.get("nickname", "anonymous"),
        "email": user.get("email"),
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
