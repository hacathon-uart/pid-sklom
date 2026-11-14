"""The two core flows. Used by BOTH the HTTP API and the Telegram bot — one code path.

AI errors/timeouts never reach the user: we fall back to StubProvider.
"""

import asyncio
import logging

from app.ai import get_ai
from app.ai.base import AIMatch
from app.ai.moderation import check_text
from app.ai.stub import StubProvider
from app.config import get_settings
from app.data import get_repo
from app.schemas import CaptionsResult, MatchCandidate, MatchResult, Source, Story

log = logging.getLogger(__name__)
_fallback = StubProvider()
_match_cache: dict[tuple[str, str], MatchResult] = {}  # repeated & demo phrases (plan §4)


class NotFoundError(LookupError):
    pass


async def match_phrase(phrase: str, description: str | None = None) -> MatchResult:
    phrase = phrase.strip()
    check_text(phrase)
    if description:
        check_text(description)
    key = (phrase.lower(), (description or "").strip().lower())
    if key in _match_cache:
        return _match_cache[key]

    repo = get_repo()
    catalogue = repo.catalogue()
    source: Source = "ai"
    try:
        ai_match: AIMatch = await asyncio.wait_for(
            get_ai().match(phrase, description, catalogue), timeout=get_settings().ai_timeout_s
        )
        if not ai_match.ranked:
            raise ValueError("empty ranking")
    except Exception:
        log.exception("AI match failed, using fallback")
        ai_match = await _fallback.match(phrase, description, catalogue)
        source = "fallback"
    if isinstance(get_ai(), StubProvider):
        source = "fallback"

    candidates = []
    for art_id, score in ai_match.ranked[:5]:
        detail = repo.get_artwork(art_id)
        if detail is not None:  # ignore ids the AI made up
            candidates.append((detail, score))
    if not candidates:
        raise NotFoundError("Каталог порожній")

    best, _ = candidates[0]
    story = _story_with_facts(best.story, best, ai_match.artwork_fact_id, ai_match.artist_fact_id)
    result = MatchResult(
        artwork=best,
        story=story,
        caption=phrase,
        position=ai_match.position,
        reason=ai_match.reason,
        alternatives=[MatchCandidate(artwork=d, score=s) for d, s in candidates],
        source=source,
    )
    _match_cache[key] = result
    return result


def _story_with_facts(story: Story, artwork, artwork_fact_id, artist_fact_id) -> Story:
    """Swap in the facts the AI chose — only if they really belong to this artwork/artist."""
    update = {}
    if artwork_fact_id is not None:
        fact = next((f for f in artwork.facts if f.id == artwork_fact_id), None)
        if fact:
            update["artwork_fact"] = fact
    if artist_fact_id is not None:
        fact = next((f for f in artwork.artist_facts if f.id == artist_fact_id), None)
        if fact:
            update["artist_fact"] = fact
    return story.model_copy(update=update)


async def suggest_captions(artwork_id: int, exclude: list[str] | None = None) -> CaptionsResult:
    repo = get_repo()
    artwork = repo.get_artwork(artwork_id)
    if artwork is None:
        raise NotFoundError("Картину не знайдено")
    fallback = repo.fallback_captions(artwork_id)
    exclude = exclude or []
    source: Source = "ai"
    try:
        captions = await asyncio.wait_for(
            get_ai().captions(artwork, fallback, exclude), timeout=get_settings().ai_timeout_s
        )
        if len(captions) < 1:
            raise ValueError("no captions")
    except Exception:
        log.exception("AI captions failed, using fallback")
        captions = await _fallback.captions(artwork, fallback, exclude)
        source = "fallback"
    if isinstance(get_ai(), StubProvider):
        source = "fallback"
    for c in captions:
        check_text(c.text)
    return CaptionsResult(artwork_id=artwork_id, captions=captions[:3], source=source)
