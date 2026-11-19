"""Durable, Telegram-only demo admission and usage.

No I/O at import time. Store errors raise DemoStoreUnavailable: callers must not
run work after that exception. Organizers bypass admission/usage storage entirely.
Request IDs are opaque (e.g. f'{chat_id}:{message_id}'), scoped to event and user.
Every started request must be finished, including failed/cancelled work. Pending
reservations older than five minutes are conservatively consumed by the next
begin, allowing new requests after a worker crash without refunding uncertain
work. A late finish cannot refund these. First finish wins; retries of any
previously started request return duplicate, including failed requests.
"""

import hashlib
import re
import secrets
from datetime import UTC, datetime

import httpx
from starlette.concurrency import run_in_threadpool

from app.config import get_settings


class DemoStoreUnavailable(RuntimeError):
    """Admission/usage could not be verified; do not authorize work."""


def _organizer(settings, user_id: int) -> bool:
    try:
        return user_id in settings.telegram_allowed_ids
    except (ValueError, RuntimeError):
        return False


def _event(settings) -> dict | None:
    event_id = getattr(settings, "telegram_demo_event_id", "")
    ends_at = getattr(settings, "telegram_demo_ends_at", None)
    if not event_id or ends_at is None:
        return None
    if (
        not isinstance(event_id, str)
        or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", event_id)
        or not isinstance(ends_at, datetime)
        or ends_at.tzinfo is None
        or ends_at.utcoffset() is None
    ):
        raise DemoStoreUnavailable("Invalid Telegram demo configuration")
    return {"p_event_id": event_id, "p_ends_at": ends_at.astimezone(UTC).isoformat()}


def _rpc_sync(settings, name: str, payload: dict):
    if not settings.supabase_url or not settings.supabase_service_key:
        raise DemoStoreUnavailable("Telegram demo store is unavailable")
    # Never include credentials, invite codes, HTTP errors or response bodies in
    # exceptions/logs. The invite secret is checked locally and never sent to SQL.
    try:
        key = settings.supabase_service_key
        with httpx.Client(
            headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=10.0,
        ) as client:
            response = client.post(
                f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/telegram_demo_{name}",
                json=payload,
            )
            response.raise_for_status()
            return response.json()
    except Exception:
        raise DemoStoreUnavailable("Telegram demo store is unavailable") from None


async def _rpc(settings, name: str, payload: dict, expected: tuple):
    result = await run_in_threadpool(_rpc_sync, settings, name, payload)
    # Strict types: bool is an int in Python; malformed JSON must never grant access.
    if not any(type(result) is type(value) and result == value for value in expected):
        raise DemoStoreUnavailable("Invalid Telegram demo store response")
    return result


def _request_key(request_id: str) -> str:
    if not isinstance(request_id, str) or not request_id:
        raise ValueError("A nonempty Telegram request ID is required")
    return hashlib.sha256(request_id.encode("utf-8")).hexdigest()


async def allowed(user_id: int) -> bool:
    settings = get_settings()
    if _organizer(settings, user_id):
        return True
    if not getattr(settings, "telegram_demo_invite_code", ""):
        return False
    event = _event(settings)
    if event is None:
        return False
    return await _rpc(settings, "allowed", {**event, "p_user_id": user_id}, (True, False))


async def enroll(user_id: int, code: str) -> str:
    settings = get_settings()
    event = _event(settings)
    if event is None:
        return "closed"
    expected = getattr(settings, "telegram_demo_invite_code", "")
    if not expected:
        return "closed"
    if (
        not isinstance(expected, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", expected)
    ):
        raise DemoStoreUnavailable("Invalid Telegram demo configuration")
    if not isinstance(code, str) or not secrets.compare_digest(code.encode(), expected.encode()):
        return "invalid"
    return await _rpc(settings, "enroll", {**event, "p_user_id": user_id}, ("enrolled", "closed"))


async def begin(user_id: int, request_id: str) -> str:
    settings = get_settings()
    if _organizer(settings, user_id):
        return "started"
    if not getattr(settings, "telegram_demo_invite_code", ""):
        return "closed"
    event = _event(settings)
    if event is None:
        return "closed"
    quota = getattr(settings, "telegram_demo_quota", 5)
    global_quota = getattr(settings, "telegram_demo_global_quota", 200)
    max_concurrent = getattr(settings, "telegram_demo_max_concurrent", 4)
    if (
        any(type(value) is not int or value < 0 for value in (quota, global_quota))
        or type(max_concurrent) is not int or max_concurrent < 1
    ):
        raise DemoStoreUnavailable("Invalid Telegram demo configuration")
    return await _rpc(settings, "begin", {
        **event, "p_user_id": user_id, "p_request_key": _request_key(request_id),
        "p_quota": quota, "p_global_quota": global_quota, "p_max_concurrent": max_concurrent,
    }, ("started", "duplicate", "limited", "busy", "closed"))


async def finish(user_id: int, request_id: str, success: bool) -> None:
    settings = get_settings()
    if _organizer(settings, user_id):
        return
    event = _event(settings)
    if event is None:
        return
    if type(success) is not bool:
        raise ValueError("Telegram request success must be a bool")
    # Finish remains possible after expiry; SQL never reopens a terminal request.
    await _rpc(settings, "finish", {
        "p_event_id": event["p_event_id"], "p_user_id": user_id,
        "p_request_key": _request_key(request_id), "p_success": success,
    }, (None,))
