"""Gemini provider (AI_PROVIDER=llm), ADR 0002.

match():
  MATCH_MODE=embeddings — embed the phrase (1 Gemini call), score every visible artwork in memory.
  MATCH_MODE=hybrid     — same top-10, then a Gemini LLM re-ranks them. Not built yet: falls back
                          to the embeddings ranking and logs it once.
captions(): Flow B is not built yet -> NotImplementedError -> services use the stub captions.

Anything that goes wrong raises; services/create.py then falls back to StubProvider (word matching).
"""

import logging

import numpy as np

from app.ai import gemini
from app.ai.base import AIMatch
from app.ai.matching import EmbeddingIndex, default_position, load_rows
from app.config import Settings
from app.data.repository import CatalogueItem
from app.schemas import ArtworkDetail, CaptionOption

log = logging.getLogger(__name__)


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
        raise NotImplementedError("Flow B (captions) with Gemini is not implemented yet")
