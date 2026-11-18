"""Telegram's native slash-command suggestions for private chats."""

from aiogram import Bot
from aiogram.types import BotCommand, BotCommandScopeAllPrivateChats, MenuButtonCommands


async def setup_commands(bot: Bot) -> None:
    await bot.set_my_commands(
        [
            BotCommand(command="start", description="Знайомство з «Під склом»"),
            BotCommand(command="help", description="Як створити мем"),
            BotCommand(command="random", description="Випадкова картина й три підписи"),
        ],
        scope=BotCommandScopeAllPrivateChats(),
    )
    await bot.set_chat_menu_button(menu_button=MenuButtonCommands())
