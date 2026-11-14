"""FastAPI entry point:  cd backend && uvicorn app.main:app --reload

API docs: http://localhost:8000/docs
"""

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import content, create, memes
from app.bot import webhook
from app.config import get_settings

logging.basicConfig(level=logging.INFO)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await webhook.setup_webhook()
    yield


app = FastAPI(title="Під склом API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",  # Vercel preview deployments
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")


@api.get("/health", tags=["meta"])
def health():
    return {
        "status": "ok",
        "data_backend": settings.data_backend,
        "ai_provider": settings.ai_provider,
        "auth_mode": settings.auth_mode,
        "bot": bool(settings.telegram_bot_token),
    }


api.include_router(content.router)
api.include_router(create.router)
api.include_router(memes.router)
app.include_router(api)
app.include_router(webhook.router)

# Local mode only: serve seed images and saved memes. In Supabase mode URLs point to Storage.
# CORS middleware also covers these, which the browser editor needs for PNG export.
if settings.data_backend == "local":
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/static/images", StaticFiles(directory=settings.images_dir), name="images")
    app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")
