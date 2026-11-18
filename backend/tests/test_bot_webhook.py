"""Telegram transport/configuration tests. No Telegram, catalogue, or AI requests."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiogram import Bot
from aiogram.exceptions import TelegramNetworkError
from aiogram.methods import GetMe
from aiogram.types import Update
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.bot import polling, webhook
from app.config import Settings

TOKEN = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"
SECRET = "test_secret-123"
HEADERS = {"X-Telegram-Bot-Api-Secret-Token": SECRET}
PATH = f"/telegram/webhook/{SECRET}"


def settings(**overrides):
    return Settings(_env_file=None, **{
        "telegram_bot_token": TOKEN,
        "telegram_webhook_secret": SECRET,
        "telegram_allowed_user_ids": "42, 73",
        "data_backend": "local", "ai_provider": "stub", "auth_mode": "stub",
        "environment": "development", "public_base_url": "http://localhost:8000",
        **overrides,
    })


def payload(user_id=42, chat_type="private", callback=False):
    message = {
        "message_id": 1, "date": 1700000000,
        "chat": {"id": 42, "type": chat_type},
        "from": {"id": user_id, "is_bot": False, "first_name": "Tester"},
        "text": "/start",
    }
    if callback:
        return {"update_id": 1, "callback_query": {
            "id": "choice", "from": message["from"], "chat_instance": "test",
            "message": message, "data": "cap:test:0",
        }}
    return {"update_id": 1, "message": message}


@pytest.fixture
def transport(monkeypatch):
    config = settings()
    bot = Bot(TOKEN)
    bot.session.make_request = AsyncMock(return_value=True)
    bot.session.close = AsyncMock()
    bot.set_webhook = AsyncMock()
    bot.delete_webhook = AsyncMock()
    dispatcher = SimpleNamespace(feed_update=AsyncMock(), start_polling=AsyncMock())
    monkeypatch.setattr(webhook, "get_settings", lambda: config)
    monkeypatch.setattr(webhook, "get_bot", lambda: bot)
    monkeypatch.setattr(webhook, "get_dispatcher", lambda: dispatcher)
    app = FastAPI()
    app.include_router(webhook.router)
    with TestClient(app, raise_server_exceptions=False) as client:
        yield SimpleNamespace(config=config, bot=bot, dp=dispatcher, client=client)


@pytest.mark.parametrize("secret", ["", "change-me", "a/b", "a b", "é", "a" * 257])
def test_invalid_secret(secret):
    with pytest.raises(RuntimeError, match="TELEGRAM_WEBHOOK_SECRET"):
        settings(telegram_webhook_secret=secret).validate_runtime()


@pytest.mark.parametrize("secret", ["a", "Az09_-", "a" * 256])
def test_valid_secret(secret):
    settings(telegram_webhook_secret=secret).validate_runtime()


@pytest.mark.parametrize("ids", ["", " ", "42,", "42,no", "-1", "0", "1.2", "1,,2"])
def test_invalid_allowlist(ids):
    with pytest.raises(RuntimeError, match="TELEGRAM_ALLOWED_USER_IDS"):
        settings(telegram_allowed_user_ids=ids).validate_runtime()


def test_allowlist_parsing_and_disabled_configuration():
    assert settings(telegram_allowed_user_ids="42, 73,42").telegram_allowed_ids == {42, 73}
    settings(telegram_bot_token="", telegram_allowed_user_ids="", telegram_webhook_secret="change-me").validate_runtime()


@pytest.mark.parametrize("path,headers,status", [
    ("/telegram/webhook/wrong", HEADERS, 404),
    ("/telegram/webhook/неправильно", HEADERS, 404),
    (PATH, {}, 403),
    (PATH, {"X-Telegram-Bot-Api-Secret-Token": "wrong"}, 403),
])
def test_rejected_auth_never_dispatches(transport, path, headers, status):
    assert transport.client.post(path, headers=headers, json=payload()).status_code == status
    transport.dp.feed_update.assert_not_awaited()


def test_disabled_bot_returns_404(transport):
    transport.config.telegram_bot_token = ""
    assert transport.client.post(PATH, headers=HEADERS, json=payload()).status_code == 404
    transport.dp.feed_update.assert_not_awaited()


@pytest.mark.parametrize("body", ["{", "null", "[]", '{}', '{"update_id":true}',
                                  '{"update_id":"1"}', '{"update_id":1,"message":{}}'])
def test_invalid_update_is_400(transport, body):
    response = transport.client.post(PATH, headers=HEADERS, content=body)
    assert response.status_code == 400
    transport.dp.feed_update.assert_not_awaited()


def test_valid_update_and_dispatch_failure(transport):
    response = transport.client.post(PATH, headers=HEADERS, json=payload())
    assert response.json() == {"ok": True}
    bot, update = transport.dp.feed_update.await_args.args
    assert bot is transport.bot and isinstance(update, Update)
    transport.dp.feed_update.side_effect = RuntimeError("dispatch failed")
    assert transport.client.post(PATH, headers=HEADERS, json=payload()).status_code == 500


@pytest.mark.parametrize("callback", [False, True])
@pytest.mark.parametrize("user_id,chat_type,allowed", [(42, "private", True), (99, "private", False),
                                                     (42, "group", False)])
def test_access_gate(transport, callback, user_id, chat_type, allowed):
    update = Update.model_validate(payload(user_id, chat_type, callback), context={"bot": transport.bot})
    handler = AsyncMock()
    asyncio.run(webhook.TesterAccessMiddleware()(handler, update, {}))
    assert handler.await_count == int(allowed)
    if user_id == 99:
        assert transport.bot.session.make_request.await_count == 1


def test_unsupported_updates_are_ignored(transport):
    update = Update(update_id=1)
    handler = AsyncMock()
    asyncio.run(webhook.TesterAccessMiddleware()(handler, update, {}))
    handler.assert_not_awaited()


def test_dispatcher_installs_access_gate():
    # Do not reattach the shared handlers router to a second dispatcher.
    dispatcher = webhook.get_dispatcher()
    assert any(isinstance(m, webhook.TesterAccessMiddleware) for m in dispatcher.update.outer_middleware)


def test_webhook_registration_preserves_updates(transport):
    transport.config.public_base_url = "https://example.com/"
    asyncio.run(webhook.setup_webhook())
    transport.bot.set_webhook.assert_awaited_once_with(
        f"https://example.com/telegram/webhook/{SECRET}", secret_token=SECRET,
        allowed_updates=["message", "callback_query"],
    )


def test_local_http_skips_registration(transport):
    asyncio.run(webhook.setup_webhook())
    transport.bot.set_webhook.assert_not_awaited()


def test_polling_preserves_updates_and_closes_on_failure(transport, monkeypatch):
    close = AsyncMock()
    monkeypatch.setattr(polling, "get_settings", lambda: transport.config)
    monkeypatch.setattr(polling, "get_bot", lambda: transport.bot)
    monkeypatch.setattr(polling, "get_dispatcher", lambda: transport.dp)
    monkeypatch.setattr(polling, "close_bot", close)
    transport.dp.start_polling.side_effect = RuntimeError("poll failed")
    with pytest.raises(RuntimeError, match="poll failed"):
        asyncio.run(polling.main())
    transport.bot.delete_webhook.assert_awaited_once_with()
    transport.dp.start_polling.assert_awaited_once_with(
        transport.bot, allowed_updates=["message", "callback_query"], close_bot_session=False,
    )
    close.assert_awaited_once()


def test_close_bot_releases_cached_session(monkeypatch):
    webhook.get_bot.cache_clear()
    monkeypatch.setattr(webhook, "get_settings", lambda: settings())
    bot = webhook.get_bot()
    bot.session.close = AsyncMock()
    asyncio.run(webhook.close_bot())
    bot.session.close.assert_awaited_once()
    assert webhook.get_bot.cache_info().currsize == 0
    asyncio.run(webhook.close_bot())  # Does not create another session.
    assert webhook.get_bot.cache_info().currsize == 0


@pytest.mark.parametrize("failure", [False, True])
def test_api_lifecycle_readiness_and_cleanup(monkeypatch, failure):
    from app import main

    monkeypatch.setattr(main, "settings", settings())
    monkeypatch.setattr(main, "get_repo", lambda: SimpleNamespace(catalogue=lambda: [object()]))
    setup = AsyncMock(side_effect=RuntimeError("registration failed") if failure else None)
    close = AsyncMock()
    monkeypatch.setattr(webhook, "setup_webhook", setup)
    monkeypatch.setattr(webhook, "close_bot", close)
    if failure:
        with pytest.raises(RuntimeError, match="registration failed"):
            with TestClient(main.app):
                pass
    else:
        with TestClient(main.app) as client:
            assert client.get("/api/ready").status_code == 200
    assert main.app.state.ready is False
    close.assert_awaited_once()


def test_telegram_registration_outage_keeps_web_api_ready(monkeypatch):
    from app import main

    monkeypatch.setattr(main, "settings", settings())
    monkeypatch.setattr(main, "get_repo", lambda: SimpleNamespace(catalogue=lambda: [object()]))
    setup = AsyncMock(side_effect=TelegramNetworkError(method=GetMe(), message="offline"))
    close = AsyncMock()
    monkeypatch.setattr(webhook, "setup_webhook", setup)
    monkeypatch.setattr(webhook, "close_bot", close)
    with TestClient(main.app) as client:
        assert client.get("/api/ready").status_code == 200
        health = client.get("/api/health").json()
        assert health["bot"] is True
        assert health["bot_webhook_ready"] is False
    close.assert_awaited_once()


def test_ambiguous_update_is_rejected_before_access_gate(transport):
    # Conflicting sender identities must never authorize the wrong event.
    body = payload(user_id=99)
    body["callback_query"] = payload(callback=True)["callback_query"]
    assert transport.client.post(PATH, headers=HEADERS, json=body).status_code == 400
    transport.dp.feed_update.assert_not_awaited()


def test_disabled_setup_never_constructs_bot(monkeypatch):
    monkeypatch.setattr(webhook, "get_settings", lambda: settings(telegram_bot_token=""))
    webhook.get_bot.cache_clear()
    asyncio.run(webhook.setup_webhook())
    assert webhook.get_bot() is None
    asyncio.run(webhook.close_bot())


def test_inaccessible_callback_does_not_dispatch(transport):
    body = payload(callback=True)
    body["callback_query"]["message"] = {
        "message_id": 1, "date": 0, "chat": {"id": 42, "type": "private"},
    }
    update = Update.model_validate(body, context={"bot": transport.bot})
    handler = AsyncMock()
    asyncio.run(webhook.TesterAccessMiddleware()(handler, update, {}))
    handler.assert_not_awaited()


def test_polling_closes_when_deleting_webhook_fails(transport, monkeypatch):
    close = AsyncMock()
    monkeypatch.setattr(polling, "get_settings", lambda: transport.config)
    monkeypatch.setattr(polling, "get_bot", lambda: transport.bot)
    monkeypatch.setattr(polling, "get_dispatcher", lambda: transport.dp)
    monkeypatch.setattr(polling, "close_bot", close)
    transport.bot.delete_webhook.side_effect = RuntimeError("delete failed")
    with pytest.raises(RuntimeError, match="delete failed"):
        asyncio.run(polling.main())
    transport.dp.start_polling.assert_not_awaited()
    close.assert_awaited_once()


def test_invalid_config_blocks_api_readiness(monkeypatch):
    from app import main

    monkeypatch.setattr(main, "settings", settings(telegram_allowed_user_ids=""))
    setup = AsyncMock()
    close = AsyncMock()
    monkeypatch.setattr(webhook, "setup_webhook", setup)
    monkeypatch.setattr(webhook, "close_bot", close)
    with pytest.raises(RuntimeError, match="TELEGRAM_ALLOWED_USER_IDS"):
        with TestClient(main.app):
            pass
    assert main.app.state.ready is False
    setup.assert_not_awaited()
    close.assert_awaited_once()
