"""No-AI provider: simple word matching + hand-written captions.

This is NOT throwaway code — it is the production fallback when the AI call fails or
times out (plan §4 «Fallbacks so the demo never breaks»). Keep it working.
"""

import hashlib
import re

from app.ai.base import AIMatch
from app.data.repository import CatalogueItem
from app.schemas import ArtworkDetail, CaptionKind, CaptionOption

_WORD = re.compile(r"[\wʼ'’-]+", re.UNICODE)

# Generic captions used when an artwork has fewer than 3 of its own.
_GENERIC: list[tuple[str, CaptionKind]] = [
    ("Коли сказав «я на хвилинку» дві години тому", "everyday"),
    ("Я, коли чую «є хвилинка поговорити?»", "work"),
    ("Тихо. Тут хтось думає про відпустку", "story"),
    ("Понеділок знову прийшов без попередження", "everyday"),
    ("Коли дедлайн завтра, а натхнення — ніколи", "work"),
]
_KINDS: list[CaptionKind] = ["everyday", "work", "story"]


def _stems(text: str) -> set[str]:
    # Crude stemming for Ukrainian: compare the first 5 letters of words with 3+ letters.
    return {w[:5] for w in _WORD.findall(text.lower()) if len(w) >= 3}


def _stable_hash(*parts: str) -> int:
    return int(hashlib.md5("|".join(parts).encode()).hexdigest()[:8], 16)


class StubProvider:
    async def match(self, phrase: str, description: str | None, catalogue: list[CatalogueItem]) -> AIMatch:
        query = _stems(f"{phrase} {description or ''}")
        scored = []
        for item in catalogue:
            words = _stems(" ".join([item.title, item.mood, *item.tags, *item.situations]))
            overlap = len(query & words)
            # Tie-break by a stable hash so different phrases give different paintings.
            scored.append((overlap, _stable_hash(phrase, str(item.id)), item.id))
        scored.sort(reverse=True)
        ranked = [(art_id, round(min(0.99, 0.55 + 0.12 * overlap), 2)) for overlap, _, art_id in scored[:5]]
        best_overlap = scored[0][0] if scored else 0
        return AIMatch(
            ranked=ranked,
            reason="Збіг за тегами" if best_overlap else "Випадковий вибір (немає збігів за тегами)",
            position="bottom",
            source="fallback",
        )

    async def captions(self, artwork: ArtworkDetail, fallback: list[str], exclude: list[str]) -> list[CaptionOption]:
        excluded = {e.strip().lower() for e in exclude}
        options = [CaptionOption(text=t, kind=_KINDS[i % 3]) for i, t in enumerate(fallback)]
        options += [CaptionOption(text=t, kind=k) for t, k in _GENERIC]
        fresh = [o for o in options if o.text.lower() not in excluded]
        return (fresh or options)[:3]
