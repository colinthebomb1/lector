from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import connect_db, close_db, is_db_connected
from app.services.challenge_loader import load_challenges
from app.routers import auth, challenges, submissions, gemma, leaderboard


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    await connect_db()
    loaded = load_challenges()
    print(f"[Lector] Loaded {len(loaded)} challenges from {settings.challenges_dir}/")
    yield
    await close_db()


app = FastAPI(
    title="Lector API",
    description="Backend for Lector — learn to read code through security and code review challenges.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(challenges.router)
app.include_router(submissions.router)
app.include_router(gemma.router)
app.include_router(leaderboard.router)


@app.get("/api/health")
async def health_check():
    settings = get_settings()
    return {
        "status": "ok",
        "app": settings.app_name,
        "database": "connected" if is_db_connected() else "unavailable",
    }
