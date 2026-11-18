"""Bot handler acceptance with real aiogram dispatch and an entirely fake transport."""

import asyncio
import io
from functools import wraps
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from aiogram import Bot, Dispatcher
from aiogram.client.session.base import BaseSession
from aiogram.methods import AnswerCallbackQuery, GetMe, SendDocument, SendMessage, SendPhoto
from aiogram.types import Message, Update, User
from PIL import Image

from app.ai.moderation import ModerationError
from app.bot import handlers as h
from app.schemas import ArtworkDetail, ArtistRef, CaptionOption, CaptionsResult, Fact, MatchResult, Story
from app.services.create import NotFoundError


def offline(test):
    """No pytest asyncio plugin is required by the repository."""
    @wraps(test)
    def run(*args, **kwargs):
        return asyncio.run(test(*args, **kwargs))
    return run


class FakeTransport(BaseSession):
    def __init__(self):
        super().__init__()
        self.calls = []
        self.fail_once = None

    async def close(self):
        pass

    async def stream_content(self, *args, **kwargs):
        raise AssertionError("No live downloads in bot tests")
        yield b""  # async generator protocol

    async def make_request(self, bot, method, timeout=None):
        self.calls.append(method)
        if self.fail_once and isinstance(method, self.fail_once):
            self.fail_once = None
            raise RuntimeError("fake transport failure")
        if isinstance(method, GetMe):
            return User(id=123, is_bot=True, first_name="Test", username="offline_bot")
        if isinstance(method, AnswerCallbackQuery):
            return True
        assert isinstance(method, (SendMessage, SendPhoto, SendDocument)), type(method)
        return Message.model_validate({
            "message_id": len(self.calls), "date": 1,
            "chat": {"id": method.chat_id, "type": "private"},
        }, context={"bot": bot})

    def of(self, kind):
        return [call for call in self.calls if isinstance(call, kind)]


class Harness:
    def __init__(self):
        self.transport = FakeTransport()
        # Syntactically valid, deliberately fake; this Bot only has FakeTransport.
        self.bot = Bot("123:offline-test-token", session=self.transport)
        self.dp = Dispatcher()
        # Copy registrations so tests don't attach the production singleton router
        # (webhook tests may independently attach it to their own dispatcher).
        self.dp.message.handlers.extend(h.router.message.handlers)
        self.dp.callback_query.handlers.extend(h.router.callback_query.handlers)
        self.sequence = 0

    def message_payload(self, text="коли дедлайн завтра", user=11, chat=11, kind="private"):
        payload = {
            "message_id": 1, "date": 1,
            "chat": {"id": chat, "type": kind},
            "from": {"id": user, "is_bot": False, "first_name": "Тестер"},
        }
        if text is not None:
            payload["text"] = text
            if text.startswith("/"):
                payload["entities"] = [{"type": "bot_command", "offset": 0, "length": len(text.split()[0])}]
        else:
            payload["sticker"] = {"file_id": "offline", "file_unique_id": "offline", "type": "regular",
                                  "width": 20, "height": 20, "is_animated": False, "is_video": False}
        return payload

    async def feed(self, **payload):
        self.sequence += 1
        update = Update.model_validate({"update_id": self.sequence, **payload}, context={"bot": self.bot})
        await self.dp.feed_update(self.bot, update)

    async def message(self, text="коли дедлайн завтра", **kwargs):
        await self.feed(message=self.message_payload(text, **kwargs))

    async def callback(self, data, user=11, chat=11, kind="private", inline=False, inaccessible=False):
        payload = {"id": str(self.sequence + 1), "chat_instance": "offline",
                   "from": {"id": user, "is_bot": False, "first_name": "Тестер"}}
        if data is not None:
            payload["data"] = data
        if inline:
            payload["inline_message_id"] = "offline"
        else:
            payload["message"] = self.message_payload("Обери підпис:", chat=chat, kind=kind)
            if inaccessible:
                payload["message"]["date"] = 0
        await self.feed(callback_query=payload)

    def choice(self, index=0):
        return self.transport.of(SendPhoto)[-1].reply_markup.inline_keyboard[index][0].callback_data


@pytest.fixture
def bot(monkeypatch):
    h._pending.clear()
    monkeypatch.setattr(h, "get_settings", lambda: SimpleNamespace(telegram_allowed_user_ids="11, 22"))
    image = io.BytesIO()
    Image.new("RGB", (32, 32), "white").save(image, format="PNG")
    png = image.getvalue()
    story = Story(
        museum="Музей", about_artwork="Перевірений опис картини.",
        artwork_fact=Fact(id=1, text="Перевірений факт про картину.", source_url="https://example.test/artwork"),
        artist_fact=Fact(id=2, text="Перевірений факт про автора.", source_url="https://example.test/artist"),
        source_url="https://example.test/catalogue",
    )
    art = ArtworkDetail(
        id=1, slug="painting", title="Картина", year=1920,
        image_url="https://never-fetch.test/image.png", thumb_url="https://never-fetch.test/thumb.png",
        artist=ArtistRef(id=1, slug="artist", name="Художник", birth_year=1880, death_year=1950),
        story=story,
    )
    repo = SimpleNamespace(random_artwork=Mock(return_value=art), get_artwork=Mock(return_value=art))
    get_repo = Mock(return_value=repo)
    match = AsyncMock(return_value=MatchResult(
        artwork=art, story=story, caption="Мемний підпис", position="top", reason="", alternatives=[], source="fallback"
    ))
    suggest = AsyncMock(return_value=CaptionsResult(
        artwork_id=1, captions=[CaptionOption(text=f"Підпис {i}", kind="everyday") for i in range(3)], source="fallback"
    ))
    fetch = AsyncMock(return_value=png)
    render = AsyncMock(return_value=png)
    monkeypatch.setattr(h, "get_repo", get_repo)
    monkeypatch.setattr(h, "match_phrase", match)
    monkeypatch.setattr(h, "suggest_captions", suggest)
    monkeypatch.setattr(h, "fetch_image", fetch)
    monkeypatch.setattr(h, "render_from_url", render)
    # Fail even if a future handler accidentally reaches an unpatched HTTP path.
    async def no_network(*args, **kwargs):
        raise AssertionError("Network is forbidden in handler tests")
    monkeypatch.setattr("httpx.AsyncClient.request", no_network)
    monkeypatch.setattr("aiohttp.ClientSession._request", no_network)
    harness = Harness()
    harness.art = art
    harness.png = png
    harness.repo = repo
    harness.get_repo = get_repo
    harness.match = match
    harness.suggest = suggest
    harness.fetch = fetch
    harness.render = render
    yield harness
    h._pending.clear()


def assert_no_generation(bot):
    bot.get_repo.assert_not_called()
    bot.match.assert_not_called()
    bot.suggest.assert_not_called()
    bot.fetch.assert_not_called()
    bot.render.assert_not_called()


@pytest.mark.parametrize("command", ["/start", "/help", "/start invite", "/help@offline_bot"])
@offline
async def test_help_dispatch(bot, command):
    await bot.message(command)
    assert bot.transport.of(SendMessage)[-1].text == h.START
    assert_no_generation(bot)


@pytest.mark.parametrize("text, expected", [
    ("/unknown", h.UNKNOWN), (None, h.NONTEXT), ("   ", h.INVALID_PHRASE), ("я" * 201, h.INVALID_PHRASE),
])
@offline
async def test_unsupported_input_never_generates(bot, text, expected):
    await bot.message(text)
    assert bot.transport.of(SendMessage)[-1].text == expected
    assert_no_generation(bot)


@pytest.mark.parametrize("text", ["/start", "/help", "/random", "фраза", None])
@offline
async def test_uninvited_user_gets_their_id_before_any_work(bot, text):
    await bot.message(text, user=999)
    notice = bot.transport.of(SendMessage)[-1].text
    assert h.ACCESS in notice and "999" in notice
    assert_no_generation(bot)


@pytest.mark.parametrize("allowed", ["", "11,garbage", None])
@offline
async def test_empty_or_malformed_allowlist_fails_closed(bot, monkeypatch, allowed):
    monkeypatch.setattr(h, "get_settings", lambda: SimpleNamespace(telegram_allowed_user_ids=allowed))
    await bot.message("/random")
    assert h.ACCESS in bot.transport.of(SendMessage)[-1].text
    assert_no_generation(bot)


@pytest.mark.parametrize("kind", ["group", "supergroup", "channel"])
@pytest.mark.parametrize("text", ["/start", "/random", "фраза", None])
@offline
async def test_only_private_chats(bot, kind, text):
    await bot.message(text, chat=-100, kind=kind)
    assert bot.transport.of(SendMessage)[-1].text == h.PRIVATE
    assert_no_generation(bot)


@offline
async def test_phrase_photo_and_identical_original_png_with_reviewed_context(bot):
    await bot.message("  коли дедлайн завтра  ")
    bot.match.assert_awaited_once_with("коли дедлайн завтра")
    blocks = bot.render.await_args.args[1]
    assert blocks[0].position == "top" and blocks[0].text == "Мемний підпис"
    photo, = bot.transport.of(SendPhoto)
    document, = bot.transport.of(SendDocument)
    assert photo.photo.data == document.document.data == bot.png
    assert document.document.filename == "meme.png"
    assert photo.parse_mode is None
    assert photo.caption == h.story_text(bot.art, bot.art.story)
    assert "Мемний підпис" not in photo.caption
    for url in ("artwork", "artist", "catalogue"):
        assert f"https://example.test/{url}" in photo.caption


@offline
async def test_long_emoji_story_preserves_all_context_and_intact_source_links(bot):
    bot.art.story.about_artwork = "🎨" * 2600
    bot.art.story.artwork_fact.text = "я" * 970
    bot.art.story.artwork_fact.source_url = "https://example.test/" + "a" * 180
    bot.match.return_value = bot.match.return_value.model_copy(update={"story": bot.art.story})
    await bot.message()
    photo, = bot.transport.of(SendPhoto)
    messages = bot.transport.of(SendMessage)
    assert messages
    assert len(photo.caption.encode("utf-16-le")) // 2 <= 1024
    assert all(len(m.text.encode("utf-16-le")) // 2 <= 4096 for m in messages)
    pieces = [photo.caption] + [m.text for m in messages]
    assert "".join(pieces) == h.story_text(bot.art, bot.art.story)
    for url in (bot.art.story.artwork_fact.source_url, bot.art.story.artist_fact.source_url, bot.art.story.source_url):
        assert any(url in piece for piece in pieces)
    assert len(bot.transport.of(SendDocument)) == 1


@pytest.mark.parametrize("stage, error, expected", [
    ("match", ModerationError(), "Спробуйте сформулювати"),
    ("match", NotFoundError(), h.EMPTY),
    ("match", RuntimeError(), h.FAILED),
    ("render", RuntimeError(), h.FAILED),
])
@offline
async def test_phrase_errors_are_ukrainian(bot, stage, error, expected):
    getattr(bot, stage).side_effect = error
    await bot.message()
    assert expected in bot.transport.of(SendMessage)[-1].text
    assert not bot.transport.of(SendDocument)


@pytest.mark.parametrize("method", [SendPhoto, SendDocument])
@offline
async def test_phrase_delivery_failure_explains_partial_delivery(bot, method):
    bot.transport.fail_once = method
    await bot.message()
    assert bot.transport.of(SendMessage)[-1].text == h.FAILED


@offline
async def test_random_success_and_duplicate_callback(bot):
    await bot.message("/random")
    preview, = bot.transport.of(SendPhoto)
    assert preview.photo.data == bot.png
    assert len(preview.reply_markup.inline_keyboard) == 3
    data = bot.choice(2)
    assert len(data.encode()) <= 64
    await bot.callback(data)
    assert bot.render.await_args.args[1][0].text == "Підпис 2"
    assert len(bot.transport.of(SendPhoto)) == 2
    assert len(bot.transport.of(SendDocument)) == 1
    assert not h._pending
    await bot.callback(data)
    assert bot.transport.of(AnswerCallbackQuery)[-1].text == h.STALE
    bot.render.assert_awaited_once()


@pytest.mark.parametrize("stage, error, expected", [
    ("repo", IndexError(), h.EMPTY), ("suggest", ModerationError(), "Спробуйте сформулювати"),
    ("suggest", NotFoundError(), h.EMPTY), ("fetch", RuntimeError(), h.FAILED),
])
@offline
async def test_random_failures_leave_no_pending_choice(bot, stage, error, expected):
    if stage == "repo":
        bot.repo.random_artwork.side_effect = error
    else:
        getattr(bot, stage).side_effect = error
    await bot.message("/random")
    assert expected in bot.transport.of(SendMessage)[-1].text
    assert not h._pending


@offline
async def test_random_preview_send_failure_removes_state(bot):
    bot.transport.fail_once = SendPhoto
    await bot.message("/random")
    assert not h._pending
    assert bot.transport.of(SendMessage)[-1].text == h.FAILED


@pytest.mark.parametrize("data", [None, "", "other", "cap", "cap:no:0", "cap:" + "a" * 16 + ":0:extra",
                                 "cap:" + "a" * 16 + ":-1", "cap:" + "a" * 16 + ":9",
                                 "cap:" + "a" * 16 + ":x", "cap:" + "a" * 16 + ":0"])
@offline
async def test_malformed_or_stale_callback(bot, data):
    await bot.callback(data)
    assert bot.transport.of(AnswerCallbackQuery)[-1].text == h.STALE
    assert_no_generation(bot)


@pytest.mark.parametrize("kwargs, expected", [
    ({"user": 22}, "іншому запиту"), ({"chat": 22}, "іншому запиту"),
    ({"user": 999}, h.ACCESS), ({"kind": "group"}, h.PRIVATE),
    ({"inline": True}, h.PRIVATE), ({"inaccessible": True}, h.PRIVATE),
])
@offline
async def test_callback_requires_private_access_and_original_user_chat(bot, kwargs, expected):
    await bot.message("/random")
    await bot.callback(bot.choice(), **kwargs)
    ack = bot.transport.of(AnswerCallbackQuery)[-1].text
    assert expected in ack
    if kwargs.get("user") == 999:
        assert "999" in ack
    bot.repo.get_artwork.assert_not_called()
    bot.render.assert_not_called()
    assert len(h._pending) == 1


@offline
async def test_callback_rechecks_allowlist(bot, monkeypatch):
    await bot.message("/random")
    monkeypatch.setattr(h, "get_settings", lambda: SimpleNamespace(telegram_allowed_user_ids=""))
    await bot.callback(bot.choice())
    assert h.ACCESS in bot.transport.of(AnswerCallbackQuery)[-1].text
    bot.render.assert_not_called()


@offline
async def test_callback_out_of_range_does_not_consume_choice(bot):
    bot.suggest.return_value.captions = bot.suggest.return_value.captions[:1]
    await bot.message("/random")
    await bot.callback(bot.choice()[:-1] + "2")
    assert bot.transport.of(AnswerCallbackQuery)[-1].text == h.STALE
    bot.render.assert_not_called()
    assert len(h._pending) == 1


@offline
async def test_expiry_and_capacity_bound(bot, monkeypatch):
    clock = Mock(return_value=1000)
    monkeypatch.setattr(h, "time", SimpleNamespace(monotonic=clock))
    monkeypatch.setattr(h, "MAX_PENDING", 1)
    await bot.message("/random")
    data = bot.choice()
    await bot.message("/random")
    assert len(h._pending) == 1
    bot.suggest.assert_awaited_once()
    clock.return_value += h.PENDING_TTL_S
    await bot.callback(data)
    assert not h._pending
    assert bot.transport.of(AnswerCallbackQuery)[-1].text == h.STALE
    await bot.message("/random")
    assert len(h._pending) == 1


@pytest.mark.parametrize("stage", ["render", "photo", "document", "story", "missing"])
@offline
async def test_callback_failure_retains_choice_for_retry(bot, stage):
    await bot.message("/random")
    data = bot.choice()
    if stage == "render":
        bot.render.side_effect = RuntimeError("render failure")
    elif stage == "missing":
        bot.repo.get_artwork.return_value = None
    elif stage == "story":
        bot.art.story.about_artwork = "я" * 2000
        bot.transport.fail_once = SendMessage
    else:
        bot.transport.fail_once = SendPhoto if stage == "photo" else SendDocument
    await bot.callback(data)
    assert len(h._pending) == 1
    choice, = h._pending.values()
    assert not choice.busy
    assert h.RETRY in bot.transport.of(SendMessage)[-1].text
    bot.render.side_effect = None
    bot.repo.get_artwork.return_value = bot.art
    await bot.callback(data)
    assert not h._pending
    assert bot.transport.of(SendDocument)[-1].document.data == bot.png


@offline
async def test_concurrent_callback_only_renders_once_and_can_retry_after_failure(bot):
    await bot.message("/random")
    data = bot.choice()
    entered, release = asyncio.Event(), asyncio.Event()
    async def slow_render(*args, **kwargs):
        entered.set()
        await release.wait()
        raise RuntimeError("temporary failure")
    bot.render.side_effect = slow_render
    first = asyncio.create_task(bot.callback(data))
    await entered.wait()
    try:
        await bot.callback(data)
        assert bot.transport.of(AnswerCallbackQuery)[-1].text == h.BUSY
        bot.render.assert_awaited_once()
    finally:
        release.set()
        await first
    assert len(h._pending) == 1
    bot.render.side_effect = None
    await bot.callback(data)
    assert bot.render.await_count == 2
    assert not h._pending


@offline
async def test_transport_failure_reporting_is_best_effort_and_sanitized(bot, caplog):
    bot.match.side_effect = RuntimeError("sensitive-token-and-url")
    bot.transport.fail_once = SendMessage
    await bot.message()
    assert "sensitive-token-and-url" not in caplog.text
    assert "RuntimeError" in caplog.text


@offline
async def test_ack_failure_does_not_lose_valid_choice(bot):
    await bot.message("/random")
    data = bot.choice()
    bot.transport.fail_once = AnswerCallbackQuery
    await bot.callback(data)
    assert not h._pending
    assert len(bot.transport.of(SendDocument)) == 1
