"""FastAPI entry point:  cd backend && uvicorn app.main:app --reload

API docs: http://localhost:8000/docs
"""

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import content, create, memes
from app.bot import webhook
from app.config import get_settings
from app.data import get_repo

logging.basicConfig(level=logging.INFO)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.ready = False
    settings.validate_runtime()
    catalogue = get_repo().catalogue()
    if not catalogue:
        raise RuntimeError("No visible artworks loaded; import approved content before deployment")
    if settings.ai_provider == "llm":
        from app.ai import get_ai
        from app.ai.llm import LLMProvider

        provider = get_ai()
        if not isinstance(provider, LLMProvider):
            raise RuntimeError("Configured embedding provider was not initialized")
        index = provider.index
        if not len(index) or index.matrix.shape[1] != settings.embedding_dim:
            raise RuntimeError("Missing or incompatible embeddings; run data/scripts/embed_artworks.py")
        if any(not index.by_artwork.get(item.id, {}).get("situation") for item in catalogue):
            raise RuntimeError("Visible artworks are missing situation embeddings; finish the embedding import")
    await webhook.setup_webhook()
    app.state.ready = True
    try:
        yield
    finally:
        app.state.ready = False


app = FastAPI(title="Під склом API", version="0.1.0", lifespan=lifespan)
app.state.ready = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
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


@api.get("/ready", tags=["meta"])
def ready():
    if not app.state.ready:
        raise HTTPException(503, "Застосунок ще не готовий")
    return {"status": "ready"}


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
