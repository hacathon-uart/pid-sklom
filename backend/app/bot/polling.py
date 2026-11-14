"""Run the bot locally without a public URL:  cd backend && python -m app.bot.polling

Needs TELEGRAM_BOT_TOKEN in backend/.env. The backend (uvicorn) must also be running,
because the bot downloads artwork images from PUBLIC_BASE_URL/static/...
Use a separate test bot from BotFather so you don't steal updates from production.
"""

import asyncio
import logging

from app.bot.webhook import get_bot, get_dispatcher


async def main() -> None:
    bot = get_bot()
    if bot is None:
        raise SystemExit("Set TELEGRAM_BOT_TOKEN in backend/.env")
    await bot.delete_webhook(drop_pending_updates=True)
    await get_dispatcher().start_polling(bot)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
