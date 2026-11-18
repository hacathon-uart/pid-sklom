"""Private tester bot using the website's creation services.

Choices live in this process for ten minutes. Restarts discard them; failed
deliveries retain them for retry, which can repeat a partially delivered meme.
"""

import logging
import re
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

from aiogram import Router
from aiogram.filters import Command, CommandStart
from aiogram.types import BufferedInputFile, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from aiogram.utils.formatting import Bold, Text, TextLink
from pydantic import ValidationError

from app.ai.moderation import ModerationError
from app.config import get_settings
from app.data import get_repo
from app.render.meme import fetch_image, render_from_url
from app.schemas import ArtworkSummary, MatchRequest, Story, TextBlock
from app.services.create import NotFoundError, match_phrase, suggest_captions

log = logging.getLogger(__name__)
router = Router()
PENDING_TTL_S = 600
MAX_PENDING = 256


@dataclass
class PendingChoice:
    artwork_id: int
    texts: tuple[str, ...]
    user_id: int
    chat_id: int
    expires_at: float
    busy: bool = False


_pending: dict[str, PendingChoice] = {}
_CALLBACK = re.compile(r"cap:([0-9a-f]{16}):([0-2])\Z")

START = (
    "Привіт! Це «Під склом» — українське мистецтво крізь жарти.\n\n"
    "Напиши фразу або опиши ситуацію (до 200 символів) — і я зроблю мем з картини українського художника.\n"
    "/random — випадкова картина і три підписи на вибір.\n"
    "/help — ця підказка. Готовий мем надішлю як фото та оригінальний PNG."
)
ACCESS = "Бот поки доступний лише запрошеним тестувальникам. Дякую за інтерес до «Під склом»!"
PRIVATE = "Напиши мені в особисті повідомлення — бот працює лише в приватних чатах."
INVALID_PHRASE = "Напиши фразу від 1 до 200 символів."
UNKNOWN = "Не знаю такої команди. Напиши фразу, надішли /random або переглянь /help."
NONTEXT = "Поки я розумію лише текст. Напиши фразу або надішли /random."
STALE = "Цей вибір застарів. Надішли /random ще раз."
BUSY = "Цей мем уже готується. Зачекай, будь ласка."
FAILED = (
    "Не вдалося завершити підготовку або надсилання фото та PNG. Спробуй ще раз; "
    "частина повідомлень може повторитися."
)
RETRY = "Не вдалося завершити надсилання. Натисни підпис ще раз; частина повідомлень може повторитися."
EMPTY = "Зараз немає доступних картин. Спробуй пізніше."


def _allowed(user_id: int) -> bool:
    # Empty or malformed configuration fails closed, including standalone slice use.
    raw = getattr(get_settings(), "telegram_allowed_user_ids", "")
    try:
        ids = {int(value.strip()) for value in raw.split(",") if value.strip()}
    except (ValueError, AttributeError):
        return False
    return user_id in ids


def _access_notice(user_id: int | None) -> str:
    return f"{ACCESS}\nТвій Telegram ID: {user_id}" if user_id is not None else ACCESS


async def _notice(message: Message, text: str) -> None:
    try:
        await message.answer(text, parse_mode=None)
    except Exception as exc:
        # Exception text may contain transport URLs or credentials.
        log.warning("Telegram notice failed (%s)", type(exc).__name__)


async def _admitted(message: Message) -> bool:
    if message.chat.type != "private":
        await _notice(message, PRIVATE)
        return False
    if message.from_user is None or not _allowed(message.from_user.id):
        await _notice(message, _access_notice(message.from_user.id if message.from_user else None))
        return False
    return True


def _prune_pending() -> None:
    now = time.monotonic()
    for token, choice in list(_pending.items()):
        if not choice.busy and choice.expires_at <= now:
            del _pending[token]


def _units(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def _source(label: str, url: str) -> Text:
    parsed = urlsplit(url)
    if parsed.scheme in ("http", "https") and parsed.netloc:
        return TextLink(label, url=url)
    return Text(label, ": ", url)


def _story_blocks(artwork: ArtworkSummary, story: Story) -> list[Text]:
    """Build Telegram entities without treating meme captions as historical facts."""
    years = f"{artwork.artist.birth_year or '?'}–{artwork.artist.death_year or '?'}"
    blocks = [Text(
        Bold(f"«{artwork.title}»"), f", {artwork.year}" if artwork.year else "",
        "\n", Bold(artwork.artist.name), f" ({years})",
    )]

    def add_body(heading: str, body: str) -> None:
        remaining = body
        first = True
        while remaining:
            fragment, remaining = _split_text(remaining, 3500)
            blocks.append(Text(Bold(heading if first else f"{heading} (продовження)"), "\n", fragment))
            first = False

    if story.museum:
        add_body("🏛 Музей", story.museum)
    if story.about_artwork:
        add_body("Про картину", story.about_artwork)
    for heading, fact in (("💡 Факт про картину", story.artwork_fact),
                          ("🎨 Факт про художника", story.artist_fact)):
        if fact:
            add_body(heading, fact.text)
            if fact.source_url:
                blocks.append(Text(_source("🔗 Джерело факту", fact.source_url)))
    if story.source_url:
        blocks.append(Text(_source("🔗 Джерело картини", story.source_url)))
    return blocks


def _story_chunks(artwork: ArtworkSummary, story: Story) -> list[Text]:
    chunks: list[Text] = []
    nodes: list[Text | str] = []
    length = 0
    limit = 1024  # first chunk goes beside the photo; subsequent messages may be 4096
    for block in _story_blocks(artwork, story):
        block_length = _units(block.render()[0])
        if nodes and length + 2 + block_length > limit:
            chunks.append(Text(*nodes))
            nodes, length, limit = [], 0, 4096
        if nodes:
            nodes.append("\n\n")
            length += 2
        nodes.append(block)
        length += block_length
    if nodes:
        chunks.append(Text(*nodes))
    return chunks


def _split_text(text: str, limit: int) -> tuple[str, str]:
    """Conservatively count UTF-16 units, preserving every code point and link."""
    units = 0
    for index, char in enumerate(text):
        units += 2 if ord(char) > 0xFFFF else 1
        if units > limit:
            # Prefer an intact paragraph, e.g. a source link, when possible.
            boundary = text.rfind("\n\n", 0, index)
            cut = boundary + 2 if boundary > 0 else index
            for link in re.finditer(r"https?://\S+", text):
                if link.start() < cut < link.end():
                    cut = link.start()
                    if cut == 0:
                        raise ValueError("Source URL exceeds Telegram message limit")
                    break
            return text[:cut], text[cut:]
    return text, ""


async def _deliver(message: Message, png: bytes, artwork: ArtworkSummary, story: Story) -> None:
    chunks = _story_chunks(artwork, story)
    caption, caption_entities = chunks[0].render()
    await message.answer_photo(
        BufferedInputFile(png, "meme.png"), caption=caption,
        caption_entities=caption_entities, parse_mode=None,
    )
    for chunk in chunks[1:]:
        text, entities = chunk.render()
        await message.answer(text, entities=entities, parse_mode=None)
    await message.answer_document(
        BufferedInputFile(png, "meme.png"), caption="Оригінальний PNG", parse_mode=None
    )


def _failure(exc: Exception) -> str:
    log.warning("Telegram generation/delivery failed (%s)", type(exc).__name__)
    if isinstance(exc, ModerationError):
        return exc.message
    if isinstance(exc, (NotFoundError, IndexError)):
        return EMPTY
    return FAILED


@router.message(CommandStart())
@router.message(Command("help"))
async def on_start(message: Message):
    if await _admitted(message):
        await _notice(message, START)


@router.message(Command("random"))
async def on_random(message: Message):
    if not await _admitted(message):
        return
    _prune_pending()
    if len(_pending) >= MAX_PENDING:
        await _notice(message, "Зараз багато запитів. Спробуй /random трохи пізніше.")
        return
    token = None
    try:
        artwork = get_repo().random_artwork()
        if artwork is None:
            raise NotFoundError()
        result = await suggest_captions(artwork.id)
        texts = tuple(c.text for c in result.captions[:3])
        if not texts or any(not t.strip() or len(t) > 200 for t in texts):
            raise ValueError("Invalid caption choices")
        photo = BufferedInputFile(await fetch_image(artwork.image_url), "painting.png")
        # Check again after awaits: concurrent /random requests may have filled it.
        _prune_pending()
        if len(_pending) >= MAX_PENDING:
            await _notice(message, "Зараз багато запитів. Спробуй /random трохи пізніше.")
            return
        token = secrets.token_hex(8)
        _pending[token] = PendingChoice(
            artwork.id, texts, message.from_user.id, message.chat.id, time.monotonic() + PENDING_TTL_S
        )
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=f"{i + 1} · Зробити мем", callback_data=f"cap:{token}:{i}")]
            for i in range(len(texts))
        ])
        preview, preview_entities = Text(Bold(f"«{artwork.title}»"), "\n", artwork.artist.name).render()
        await message.answer_photo(photo, caption=preview, caption_entities=preview_entities, parse_mode=None)
        choices = Text(Bold("Обери підпис до картини:"), "\n\n", *[
            Text(Bold(f"{i + 1}. "), caption, "\n\n" if i < len(texts) - 1 else "")
            for i, caption in enumerate(texts)
        ])
        choices_text, choices_entities = choices.render()
        await message.answer(choices_text, entities=choices_entities, reply_markup=keyboard, parse_mode=None)
    except Exception as exc:
        if token is not None:
            _pending.pop(token, None)
        await _notice(message, _failure(exc))


async def _ack(callback: CallbackQuery, text: str | None = None) -> None:
    try:
        await callback.answer(text, show_alert=bool(text))
    except Exception as exc:
        log.warning("Telegram callback acknowledgement failed (%s)", type(exc).__name__)


@router.callback_query()
async def on_caption_chosen(callback: CallbackQuery):
    message = callback.message
    if not isinstance(message, Message) or message.date.timestamp() <= 0 or message.chat.type != "private":
        await _ack(callback, PRIVATE)
        return
    if not _allowed(callback.from_user.id):
        await _ack(callback, _access_notice(callback.from_user.id))
        return
    _prune_pending()
    match = _CALLBACK.fullmatch(callback.data or "")
    if not match:
        await _ack(callback, STALE)
        return
    token, index_text = match.groups()
    choice = _pending.get(token)
    index = int(index_text)
    if choice is None or index >= len(choice.texts):
        await _ack(callback, STALE)
        return
    if choice.user_id != callback.from_user.id or choice.chat_id != message.chat.id:
        await _ack(callback, "Цей вибір належить іншому запиту. Надішли /random у своєму чаті.")
        return
    # No await between checking and claiming state: simultaneous presses cannot render twice.
    if choice.busy:
        await _ack(callback, BUSY)
        return
    choice.busy = True
    try:
        await _ack(callback)
        detail = get_repo().get_artwork(choice.artwork_id)
        if detail is None:
            raise NotFoundError()
        png = await render_from_url(detail.image_url, [TextBlock(text=choice.texts[index])])
        await _deliver(message, png, detail, detail.story)
        _pending.pop(token, None)
    except Exception as exc:
        text = _failure(exc)
        await _notice(message, f"{text}\n{RETRY}")
    finally:
        # Release even on task cancellation; active entries cannot be pruned.
        choice.busy = False
        choice.expires_at = time.monotonic() + PENDING_TTL_S


@router.message()
async def on_phrase(message: Message):
    if not await _admitted(message):
        return
    if message.text is None:
        await _notice(message, NONTEXT)
        return
    phrase = message.text.strip()
    if phrase.startswith("/"):
        await _notice(message, UNKNOWN)
        return
    try:
        request = MatchRequest(phrase=phrase)
    except ValidationError:
        await _notice(message, INVALID_PHRASE)
        return
    try:
        result = await match_phrase(request.phrase)
        png = await render_from_url(result.artwork.image_url, [TextBlock(text=result.caption, position=result.position)])
        await _deliver(message, png, result.artwork, result.story)
    except Exception as exc:
        await _notice(message, _failure(exc))
