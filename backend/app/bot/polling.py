"""Run the bot locally without a public URL:  cd backend && python -m app.bot.polling

Needs TELEGRAM_BOT_TOKEN in backend/.env. The backend (uvicorn) must also be running,
because the bot downloads artwork images from PUBLIC_BASE_URL/static/...
Use a separate test bot from BotFather so you don't steal updates from production.
"""

import asyncio
import logging

from app.bot.webhook import close_bot, get_bot, get_dispatcher
from app.config import get_settings


async def main() -> None:
    get_settings().validate_runtime()
    bot = get_bot()
    if bot is None:
        raise SystemExit("Set TELEGRAM_BOT_TOKEN in backend/.env")
    try:
        await bot.delete_webhook()
        await get_dispatcher().start_polling(
            bot, allowed_updates=["message", "callback_query"], close_bot_session=False,
        )
    finally:
        await close_bot()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
