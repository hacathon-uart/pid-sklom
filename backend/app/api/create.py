"""Public AI flows with optional durable guest allowance."""

import asyncio
import logging
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app import operations
from app.ai.moderation import ModerationError
from app.auth import User, optional_user
from app.config import get_settings
from app.schemas import CaptionsRequest, CaptionsResult, MatchRequest, MatchResult
from app.services import create

router = APIRouter(tags=["create"])
log = logging.getLogger(__name__)


async def generate(
    kind: str, payload: dict, action: Callable[[], Awaitable[BaseModel]], response: Response,
    user: User | None, guest_token: str | None, request_id: str | None,
):
    settings = get_settings()
    operation = None
    actor = None
    if settings.guest_limit_enabled or (user and settings.auth_mode == "supabase"):
        actor = f"user:{user.id}" if user else operations.guest_actor(guest_token)
        operation = await run_in_threadpool(operations.begin, actor, request_id, kind, payload, user is None)
    try:
        if operation and operation["status"] == "complete":
            result = operation["response"]
        else:
            result = (await action()).model_dump(mode="json")
            if operation:
                await run_in_threadpool(operations.finish, operation, result)
    except BaseException:
        if operation and operation["status"] == "started":
            try:
                await asyncio.shield(run_in_threadpool(operations.finish, operation, None, False))
            except HTTPException:
                log.error("Failed to release operation reservation; lease will expire")
        raise
    if actor and not user:
        response.headers["X-Guest-Remaining"] = str(await run_in_threadpool(operations.remaining, actor))
    return result


@router.post("/matches", response_model=MatchResult, status_code=201)
async def create_match(
    body: MatchRequest, response: Response, user: User | None = Depends(optional_user),
    x_guest_token: str | None = Header(default=None), idempotency_key: str | None = Header(default=None),
):
    """Flow A: a phrase creates a match, i.e. the painting chosen for it (US-01). Screens 2 → 3."""
    try:
        return await generate(
            "match", body.model_dump(), lambda: create.match_phrase(body.phrase, body.description),
            response, user, x_guest_token, idempotency_key,
        )
    except ModerationError as e:
        raise HTTPException(422, e.message) from e
    except create.NotFoundError as e:
        raise HTTPException(404, str(e)) from e


@router.post("/artworks/{artwork_id}/captions", response_model=CaptionsResult, status_code=201)
async def create_captions(
    artwork_id: int, body: CaptionsRequest, response: Response, user: User | None = Depends(optional_user),
    x_guest_token: str | None = Header(default=None), idempotency_key: str | None = Header(default=None),
):
    """Flow B: generate 3 captions for a painting (US-02). Screen 3c, «Ще варіанти» sends `exclude`."""
    try:
        return await generate(
            "captions", {"artwork_id": artwork_id, **body.model_dump()},
            lambda: create.suggest_captions(artwork_id, body.exclude),
            response, user, x_guest_token, idempotency_key,
        )
    except ModerationError as e:
        raise HTTPException(422, e.message) from e
    except create.NotFoundError as e:
        raise HTTPException(404, str(e)) from e
