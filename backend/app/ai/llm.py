"""Gemini provider (AI_PROVIDER=llm), ADR 0002.

match():
  MATCH_MODE=embeddings — embed the phrase (1 Gemini call), score every visible artwork in memory.
  MATCH_MODE=hybrid     — same top-10, then a Gemini LLM re-ranks them. Not built yet: falls back
                          to the embeddings ranking and logs it once.
captions(): Flow B — one Gemini JSON call over the artwork's text profile (no image is sent).

Anything that goes wrong raises; services/create.py then falls back to StubProvider (word matching).
"""

import logging

import numpy as np

from app.ai import gemini, prompts
from app.ai.base import AIMatch
from app.ai.matching import EmbeddingIndex, default_position, load_rows
from app.config import Settings
from app.data import get_repo
from app.data.repository import CatalogueItem
from app.schemas import ArtworkDetail, CaptionKind, CaptionOption

log = logging.getLogger(__name__)
_KINDS: list[CaptionKind] = ["everyday", "work", "story"]


class LLMProvider:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._index: EmbeddingIndex | None = None
        self._query_cache: dict[str, np.ndarray] = {}
        self._warned_hybrid = False

    @property
    def index(self) -> EmbeddingIndex:
        if self._index is None:
            rows = load_rows(self.settings)
            self._index = EmbeddingIndex(rows)
            log.info("Embedding index: %d vectors for %d artworks (%s, %d dims)", len(rows),
                     len(self._index.by_artwork), self.settings.embedding_model, self.settings.embedding_dim)
        return self._index

    async def _embed(self, text: str) -> np.ndarray:
        key = " ".join(text.lower().split())
        if key not in self._query_cache:
            s = self.settings
            self._query_cache[key] = await gemini.embed_query(
                text, api_key=s.ai_api_key, model=s.embedding_model, dim=s.embedding_dim, timeout=s.embedding_timeout_s
            )
        return self._query_cache[key]

    async def match(self, phrase: str, description: str | None, catalogue: list[CatalogueItem]) -> AIMatch:
        if not self.settings.ai_api_key:
            raise RuntimeError("AI_PROVIDER=llm needs AI_API_KEY (Gemini key from Google AI Studio)")
        index = self.index
        if not len(index):
            raise RuntimeError("No embeddings loaded — run data/scripts/embed_artworks.py")
        query = await self._embed(f"{phrase} — {description}" if description else phrase)
        s = self.settings
        ranked = index.rank(
            query,
            catalogue,
            weight_situation=s.match_weight_situation,
            avoid_threshold=s.match_avoid_threshold,
            sensitive_penalty=s.match_sensitive_penalty,
            limit=5,
        )
        if not ranked:
            raise RuntimeError("No artwork has embeddings — run data/scripts/embed_artworks.py")
        if s.match_mode == "hybrid" and not self._warned_hybrid:
            log.warning("MATCH_MODE=hybrid is not implemented yet; using the embeddings ranking")
            self._warned_hybrid = True
        by_id = {item.id: item for item in catalogue}
        for r in ranked:
            log.info("match %r -> %d %.3f «%s»", phrase, r.artwork_id, r.score, r.reason)
        return AIMatch(
            # score=None: raw cosine values sit in a narrow band; the UI hides «збіг» until calibrated (ADR 0002 §4)
            ranked=[(r.artwork_id, None) for r in ranked],
            reason=f"Схоже на: {ranked[0].reason}",
            position=default_position(by_id.get(ranked[0].artwork_id)),
            source="embeddings",
        )

    async def captions(self, artwork: ArtworkDetail, fallback: list[str], exclude: list[str]) -> list[CaptionOption]:
        s = self.settings
        if not s.ai_api_key:
            raise RuntimeError("AI_PROVIDER=llm needs AI_API_KEY (Gemini key from Google AI Studio)")
        item = next((c for c in get_repo().catalogue() if c.id == artwork.id), None)
        profile = "; ".join(
            part
            for part in (
                artwork.about,
                f"настрій: {item.mood}" if item and item.mood else "",
                f"ситуації: {' | '.join(item.situations)}" if item and item.situations else "",
                f"теги: {', '.join(artwork.tags)}" if artwork.tags else "",
            )
            if part
        )
        sensitivity = ""
        if item and item.is_sensitive:
            sensitivity += prompts.CAPTIONS_SENSITIVE
        if item and item.do_not_use_for:
            sensitivity += prompts.CAPTIONS_NO_GO.format(topics="; ".join(item.do_not_use_for))
        prompt = prompts.CAPTIONS.format(
            sensitivity=sensitivity,
            title=artwork.title,
            artist=artwork.artist.name,
            profile=profile or "немає опису",
            exclude="; ".join(exclude) or "—",
        )
        data = await gemini.generate_json(
            prompt, system=prompts.SYSTEM, api_key=s.ai_api_key, model=s.ai_model, timeout=s.ai_timeout_s
        )
        seen = {e.strip().lower() for e in exclude}
        out: list[CaptionOption] = []
        for i, raw in enumerate(data.get("captions") or []):
            text = str(raw.get("text", "")).strip() if isinstance(raw, dict) else ""
            if not text or text.lower() in seen:
                continue
            seen.add(text.lower())
            kind = raw.get("kind")
            out.append(CaptionOption(text=text, kind=kind if kind in _KINDS else _KINDS[i % 3]))
        if not out:
            raise ValueError("Gemini returned no usable captions")
        return out[:3]
