"""FastAPI entry point:  cd backend && uvicorn app.main:app --reload

API docs: http://localhost:8000/docs
"""

import logging
from contextlib import asynccontextmanager

import httpx
from aiogram.exceptions import TelegramAPIError
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import content, create, exports, guest, memes
from app.bot import webhook
from app.config import get_settings
from app.data import get_repo

logging.basicConfig(level=logging.INFO)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.ready = False
    app.state.bot_webhook_ready = False
    # Invalid configuration still blocks startup. A Telegram transport failure is
    # reported separately so a temporary bot outage does not take down the website.
    try:
        settings.validate_runtime()
        if settings.auth_mode == "supabase":
            from app import operations

            operations.remaining("startup")
            if settings.guest_export_limit_enabled:
                operations.export_remaining("startup")
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
        try:
            app.state.bot_webhook_ready = await webhook.setup_webhook()
        except TelegramAPIError as error:
            logging.getLogger(__name__).warning(
                "Telegram webhook registration failed (%s)", type(error).__name__
            )
        app.state.ready = True
        yield
    finally:
        app.state.ready = False
        app.state.bot_webhook_ready = False
        await webhook.close_bot()


app = FastAPI(title="Під склом API", version="0.1.0", lifespan=lifespan)
app.state.ready = False
app.state.bot_webhook_ready = False


@app.exception_handler(httpx.HTTPError)
async def upstream_error(_request, error: httpx.HTTPError):
    logging.getLogger(__name__).error("Upstream persistence request failed (%s)", type(error).__name__)
    return JSONResponse(status_code=503, content={"detail": "Сховище тимчасово недоступне. Повторіть дію"})


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Guest-Remaining", "X-Guest-Exports-Remaining"],
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
        "bot_webhook_ready": app.state.bot_webhook_ready,
    }


@api.get("/ready", tags=["meta"])
def ready():
    if not app.state.ready:
        raise HTTPException(503, "Застосунок ще не готовий")
    return {"status": "ready"}


api.include_router(content.router)
api.include_router(create.router)
api.include_router(memes.router)
api.include_router(guest.router)
api.include_router(exports.router)
app.include_router(api)
app.include_router(webhook.router)

# Local mode only: serve seed images and saved memes. In Supabase mode URLs point to Storage.
# CORS middleware also covers these, which the browser editor needs for PNG export.
if settings.data_backend == "local":
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/static/images", StaticFiles(directory=settings.images_dir), name="images")
    app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")
