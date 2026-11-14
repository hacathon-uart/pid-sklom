"""Bot runs inside the FastAPI process on Render (webhook mode, no separate server)."""

import logging
from functools import lru_cache

from aiogram import Bot, Dispatcher
from aiogram.types import Update
from fastapi import APIRouter, HTTPException, Request

from app.bot.handlers import router as bot_router
from app.config import get_settings

log = logging.getLogger(__name__)
router = APIRouter(tags=["telegram"])


@lru_cache
def get_bot() -> Bot | None:
    token = get_settings().telegram_bot_token
    return Bot(token) if token else None


@lru_cache
def get_dispatcher() -> Dispatcher:
    dp = Dispatcher()
    dp.include_router(bot_router)
    return dp


async def setup_webhook() -> None:
    settings = get_settings()
    bot = get_bot()
    if bot is None:
        log.info("TELEGRAM_BOT_TOKEN not set — bot disabled")
        return
    if not settings.public_base_url.startswith("https://"):
        log.info("PUBLIC_BASE_URL is not https — skipping webhook; use `python -m app.bot.polling` locally")
        return
    url = f"{settings.public_base_url}/telegram/webhook/{settings.telegram_webhook_secret}"
    await bot.set_webhook(url, drop_pending_updates=True)
    log.info("Telegram webhook set")


@router.post("/telegram/webhook/{secret}", include_in_schema=False)
async def telegram_webhook(secret: str, request: Request):
    bot = get_bot()
    if bot is None or secret != get_settings().telegram_webhook_secret:
        raise HTTPException(404)
    update = Update.model_validate(await request.json(), context={"bot": bot})
    await get_dispatcher().feed_update(bot, update)
    return {"ok": True}
