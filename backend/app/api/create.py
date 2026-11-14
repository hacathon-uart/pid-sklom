"""AI flows. TODO(A, T21): per-IP rate limit (slowapi, ~20/hour) on both endpoints."""

from fastapi import APIRouter, HTTPException

from app.ai.moderation import ModerationError
from app.schemas import CaptionsRequest, CaptionsResult, MatchRequest, MatchResult
from app.services import create

router = APIRouter(tags=["create"])


@router.post("/matches", response_model=MatchResult, status_code=201)
async def create_match(body: MatchRequest):
    """Flow A: a phrase creates a match, i.e. the painting chosen for it (US-01). Screens 2 → 3."""
    try:
        return await create.match_phrase(body.phrase, body.description)
    except ModerationError as e:
        raise HTTPException(422, e.message) from e
    except create.NotFoundError as e:
        raise HTTPException(404, str(e)) from e


@router.post("/artworks/{artwork_id}/captions", response_model=CaptionsResult, status_code=201)
async def create_captions(artwork_id: int, body: CaptionsRequest):
    """Flow B: generate 3 captions for a painting (US-02). Screen 3c, «Ще варіанти» sends `exclude`."""
    try:
        return await create.suggest_captions(artwork_id, body.exclude)
    except ModerationError as e:
        raise HTTPException(422, e.message) from e
    except create.NotFoundError as e:
        raise HTTPException(404, str(e)) from e
