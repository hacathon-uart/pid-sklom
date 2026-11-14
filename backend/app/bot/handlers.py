"""Telegram bot handlers (owner: D — T07, T19, T26). Same services as the website.

Local dev:  python -m app.bot.polling     (no public URL needed)
Production: webhook inside FastAPI, see app/bot/webhook.py
"""

import logging
import secrets

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    BufferedInputFile,
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

from app.ai.moderation import ModerationError
from app.data import get_repo
from app.render.meme import fetch_image, render_from_url
from app.schemas import ArtworkSummary, Story, TextBlock
from app.services.create import match_phrase, suggest_captions

log = logging.getLogger(__name__)
router = Router()

# /random caption choices: callback_data is limited to 64 bytes, so we keep the texts here.
# In-memory is fine for a hackathon (lost on restart → user just sends /random again).
_pending: dict[str, tuple[int, list[str]]] = {}

START = (
    "Привіт! Це «Під склом» — українське мистецтво крізь жарти.\n\n"
    "Напиши фразу або опиши ситуацію — і я зроблю мем з картини українського художника.\n"
    "/random — випадкова картина і три підписи на вибір."
)


def story_text(artwork: ArtworkSummary, story: Story) -> str:
    years = f"{artwork.artist.birth_year or '?'}–{artwork.artist.death_year or '?'}"
    parts = [f"«{artwork.title}»{', ' + str(artwork.year) if artwork.year else ''}",
             f"{artwork.artist.name} ({years})"]
    if story.artwork_fact:
        parts.append(f"\n💡 {story.artwork_fact.text}")
    if story.artist_fact:
        parts.append(f"\n🎨 {story.artist_fact.text}")
    return "\n".join(parts)[:1024]  # Telegram photo caption limit


@router.message(CommandStart())
async def on_start(message: Message):
    await message.answer(START)


@router.message(Command("random"))
async def on_random(message: Message):
    artwork = get_repo().random_artwork()
    result = await suggest_captions(artwork.id)
    token = secrets.token_hex(4)
    texts = [c.text for c in result.captions]
    _pending[token] = (artwork.id, texts)
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=t, callback_data=f"cap:{token}:{i}")] for i, t in enumerate(texts)]
    )
    photo = BufferedInputFile(await fetch_image(artwork.image_url), "painting.png")
    await message.answer_photo(photo, caption="Обери підпис:", reply_markup=keyboard)


@router.callback_query(F.data.startswith("cap:"))
async def on_caption_chosen(callback: CallbackQuery):
    _, token, idx = callback.data.split(":")
    if token not in _pending:
        await callback.answer("Цей вибір застарів, надішли /random ще раз")
        return
    artwork_id, texts = _pending.pop(token)
    await callback.answer()
    detail = get_repo().get_artwork(artwork_id)
    png = await render_from_url(detail.image_url, [TextBlock(text=texts[int(idx)])])
    await callback.message.answer_photo(BufferedInputFile(png, "meme.png"), caption=story_text(detail, detail.story))


@router.message(F.text)
async def on_phrase(message: Message):
    try:
        result = await match_phrase(message.text)
    except ModerationError as e:
        await message.answer(e.message)
        return
    png = await render_from_url(result.artwork.image_url, [TextBlock(text=result.caption, position=result.position)])
    await message.answer_photo(BufferedInputFile(png, "meme.png"), caption=story_text(result.artwork, result.story))
