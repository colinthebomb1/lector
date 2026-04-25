import uuid

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, HTTPException, Request, Response
from passlib.hash import pbkdf2_sha256
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from app.config import get_settings
from app.database import get_db
from app.models import User
from app.services.streak import current_streak

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
        email = _normalize_email(v)
        if not email:
            raise ValueError("Invalid email format")
        return email


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class GoogleAuthRequest(BaseModel):
    credential: str


def _normalize_email(value: str) -> str | None:
    try:
        result = validate_email(value.strip(), check_deliverability=False)
    except EmailNotValidError:
        return None
    return result.normalized.lower()


def _set_session_cookie(response: Response, session_id: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        samesite="lax",
        max_age=settings.session_max_age,
    )


async def _verify_google_credential(credential: str, client_id: str) -> dict:
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="Google sign-in dependencies are not installed",
        ) from exc

    try:
        token_info = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            client_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid Google credential") from exc

    if not token_info.get("sub"):
        raise HTTPException(status_code=401, detail="Google credential missing subject")
    return token_info


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


@router.get("/google/client-id")
async def get_google_client_id():
    settings = get_settings()
    return {
        "configured": bool(settings.google_client_id),
        "client_id": settings.google_client_id or None,
    }


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
        auth_provider="password",
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
        "auth_provider": user.auth_provider,
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
        "auth_provider": user.get("auth_provider", "password"),
    }


@router.post("/google")
async def login_with_google(
    body: GoogleAuthRequest,
    response: Response,
):
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")

    token_info = await _verify_google_credential(body.credential, settings.google_client_id)
    google_sub = token_info["sub"]
    email = token_info.get("email")
    name = (
        token_info.get("name")
        or token_info.get("given_name")
        or (email.split("@")[0] if email else "reader")
    )

    db = get_db()
    user = await db.users.find_one({"google_sub": google_sub})
    if not user and email:
        user = await db.users.find_one({"email": email})

    if user:
        updates = {
            "nickname": name,
            "name": token_info.get("name") or name,
            "email": email,
            "auth_provider": "google",
            "google_sub": google_sub,
            "avatar_url": token_info.get("picture"),
        }
        await db.users.update_one({"session_id": user["session_id"]}, {"$set": updates})
        session_id = user["session_id"]
    else:
        new_user = User(
            session_id=str(uuid.uuid4()),
            nickname=name,
            name=token_info.get("name") or name,
            email=email,
            auth_provider="google",
            google_sub=google_sub,
            avatar_url=token_info.get("picture"),
        )
        await db.users.insert_one(new_user.model_dump())
        session_id = new_user.session_id
        user = new_user.model_dump()

    _set_session_cookie(response, session_id)
    return {
        "session_id": session_id,
        "nickname": name,
        "email": email,
        "auth_provider": "google",
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
    streak = await current_streak(get_db(), user["session_id"])
    return {
        "authenticated": True,
        "nickname": user.get("nickname", "anonymous"),
        "name": user.get("name"),
        "email": user.get("email"),
        "auth_provider": user.get("auth_provider", "password"),
        "avatar_url": user.get("avatar_url"),
        "challenges_completed": user.get("challenges_completed", []),
        "total_score": user.get("total_score", 0),
        "streak": streak,
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
