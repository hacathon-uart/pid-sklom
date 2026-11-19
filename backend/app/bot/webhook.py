"""Bot runs inside the FastAPI process on Render (webhook mode, no separate server)."""

import logging
import secrets
from functools import lru_cache

from aiogram import BaseMiddleware, Bot, Dispatcher
from aiogram.types import Message, Update
from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app.bot.commands import setup_commands
from app.bot.handlers import router as bot_router
from app.config import get_settings

log = logging.getLogger(__name__)
router = APIRouter(tags=["telegram"])


class TesterAccessMiddleware(BaseMiddleware):
    """Gate both transports before any handler can generate content."""

    async def __call__(self, handler, event: Update, data):
        message = event.message
        callback = event.callback_query
        if callback is not None:
            message = callback.message
            user = callback.from_user
        else:
            user = message.from_user if message is not None else None
        # Ignore groups, inline queries, channel posts, and inaccessible callback messages.
        if not isinstance(message, Message) or message.chat.type != "private" or user is None or user.is_bot:
            if callback is not None:
                await callback.answer("Бот працює лише в приватному чаті")
            return
        if user.id not in get_settings().telegram_allowed_ids:
            text = (
                "Зараз бот доступний лише запрошеним учасникам тестування.\n"
                f"Твій Telegram ID: {user.id}"
            )
            if callback is not None:
                await callback.answer(text, show_alert=True)
            else:
                await message.answer(text)
            return
        return await handler(event, data)


@lru_cache
def get_bot() -> Bot | None:
    token = get_settings().telegram_bot_token
    return Bot(token) if token else None


@lru_cache
def get_dispatcher() -> Dispatcher:
    dp = Dispatcher()
    dp.update.outer_middleware(TesterAccessMiddleware())
    dp.include_router(bot_router)
    return dp


async def setup_webhook() -> bool:
    settings = get_settings()
    settings.validate_runtime()
    bot = get_bot()
    if bot is None:
        log.info("TELEGRAM_BOT_TOKEN not set — bot disabled")
        return False
    if not settings.public_base_url.startswith("https://"):
        log.info("PUBLIC_BASE_URL is not https — skipping webhook; use `python -m app.bot.polling` locally")
        return False
    await setup_commands(bot)
    url = f"{settings.public_base_url.rstrip('/')}/telegram/webhook/{settings.telegram_webhook_secret}"
    await bot.set_webhook(
        url, secret_token=settings.telegram_webhook_secret,
        allowed_updates=["message", "callback_query"],
    )
    log.info("Telegram webhook set")
    return True


async def close_bot() -> None:
    """Close an already created session, including after partial startup failure."""
    if get_bot.cache_info().currsize:
        bot = get_bot()
        try:
            if bot is not None:
                await bot.session.close()
        finally:
            get_bot.cache_clear()


@router.post("/telegram/webhook/{secret}", include_in_schema=False)
async def telegram_webhook(secret: str, request: Request):
    settings = get_settings()
    if not settings.telegram_bot_token:
        raise HTTPException(404)
    # Compare bytes so non-ASCII untrusted input is rejected without a TypeError.
    expected = settings.telegram_webhook_secret.encode()
    if not secrets.compare_digest(secret.encode(), expected):
        raise HTTPException(404)
    header = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if not secrets.compare_digest(header.encode(), expected):
        raise HTTPException(403, "Invalid Telegram secret token")
    bot = get_bot()
    try:
        payload = await request.json()
        if not isinstance(payload, dict) or type(payload.get("update_id")) is not int:
            raise ValueError("Invalid update envelope")
        update = Update.model_validate(payload, context={"bot": bot})
        if sum(getattr(update, name) is not None for name in Update.model_fields if name != "update_id") > 1:
            raise ValueError("An update must contain at most one event")
    except (ValueError, ValidationError):
        raise HTTPException(400, "Invalid Telegram update") from None
    # Dispatch failures intentionally propagate as 5xx so Telegram can retry.
    await get_dispatcher().feed_update(bot, update)
    return {"ok": True}
