"""Durable reservations and replay at the HTTP seam; never used by the bot."""

import hashlib
import hmac
import json
import logging
import secrets
from functools import lru_cache
from uuid import UUID

import httpx
from fastapi import HTTPException

from app.config import get_settings

log = logging.getLogger(__name__)


def issue_guest() -> str:
    identity = secrets.token_hex(24)
    return f"{identity}.{_signature(identity)}"


def _signature(identity: str) -> str:
    return hmac.new(get_settings().guest_token_secret.encode(), identity.encode(), hashlib.sha256).hexdigest()


def guest_actor(token: str | None) -> str:
    if not token or len(token) != 113:
        raise HTTPException(401, detail={"code": "guest_required", "message": "Оновіть гостьову сесію"})
    identity, separator, signature = token.partition(".")
    if not separator or not hmac.compare_digest(signature, _signature(identity)):
        raise HTTPException(401, detail={"code": "guest_required", "message": "Гостьова сесія недійсна"})
    return f"guest:{identity}"


@lru_cache
def _http() -> httpx.Client:
    return httpx.Client(timeout=15)


def rpc(name: str, values: dict):
    settings = get_settings()
    try:
        response = _http().post(
            f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/{name}",
            headers={"apikey": settings.supabase_service_key,
                     "Authorization": f"Bearer {settings.supabase_service_key}"},
            json=values,
        )
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as error:
        log.error("Operation store unavailable (%s)", type(error).__name__)
        raise HTTPException(503, "Збереження та ліміт тимчасово недоступні. Спробуйте ще раз") from error


def remaining(actor: str) -> int:
    return rpc("operation_remaining", {"p_actor": actor})


def begin(actor: str, request_id: str | None, kind: str, payload: dict, limited: bool) -> dict:
    try:
        request_id = str(UUID(request_id or ""))
    except ValueError as error:
        raise HTTPException(422, "Потрібен UUID Idempotency-Key") from error
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    operation = rpc("operation_begin", {
        "p_actor": actor, "p_request_id": request_id, "p_kind": kind,
        "p_payload_hash": digest, "p_limited": limited,
    })
    status = operation["status"]
    errors = {
        "limited": (403, "guest_limit_exceeded", "Три безкоштовні генерації використано. Увійдіть через Google"),
        "pending": (409, "operation_pending", "Запит ще виконується"),
        "conflict": (409, "operation_conflict", "Цей запит уже використано для іншої дії"),
    }
    if status in errors:
        code, tag, message = errors[status]
        raise HTTPException(code, detail={"code": tag, "message": message})
    return {**operation, "actor": actor, "request_id": request_id}


def finish(operation: dict, response: dict | None, success: bool = True) -> None:
    recorded = rpc("operation_finish", {
        "p_actor": operation["actor"], "p_request_id": operation["request_id"],
        "p_lease": operation["lease"], "p_response": response, "p_success": success,
    })
    if not recorded:
        raise HTTPException(503, "Час запиту вичерпано. Повторіть дію")
