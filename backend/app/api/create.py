"""AI flows. TODO(A, T21): per-IP rate limit (slowapi, ~20/hour) on both endpoints."""

from fastapi import APIRouter, HTTPException

from app.ai.moderation import ModerationError
from app.schemas import CaptionsRequest, CaptionsResult, MatchRequest, MatchResult
from app.services import create

router = APIRouter(tags=["create"])


@router.post("/match", response_model=MatchResult)
async def match(body: MatchRequest):
    """Flow A, phrase → painting (US-01). Screens 2 → 3."""
    try:
        return await create.match_phrase(body.phrase, body.description)
    except ModerationError as e:
        raise HTTPException(422, e.message) from e
    except create.NotFoundError as e:
        raise HTTPException(404, str(e)) from e


@router.post("/captions", response_model=CaptionsResult)
async def captions(body: CaptionsRequest):
    """Flow B, painting → 3 captions (US-02). Screen 3c, «Ще варіанти» sends `exclude`."""
    try:
        return await create.suggest_captions(body.artwork_id, body.exclude)
    except ModerationError as e:
        raise HTTPException(422, e.message) from e
    except create.NotFoundError as e:
        raise HTTPException(404, str(e)) from e
