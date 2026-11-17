"""In-memory embedding index and scoring (ADR 0002 §2–4).

Every artwork has several vectors: «whole» (its full profile), one «situation» per meme
situation and one «avoid» per do_not_use_for rule. For a phrase vector q:

    score = w · max(q·situation) + (1 - w) · (q·whole)
    dropped if max(q·avoid) >= avoid_threshold
    × sensitive_penalty if the artwork is_sensitive

All vectors are L2-normalised, so a dot product is the cosine similarity.
"""

import json
import logging
from dataclasses import dataclass

import httpx
import numpy as np

from app.config import Settings
from app.data.repository import CatalogueItem
from app.schemas import Position

log = logging.getLogger(__name__)


@dataclass
class Ranked:
    artwork_id: int
    score: float
    reason: str  # the best-matching situation, shown as «Схоже на: …»


class EmbeddingIndex:
    def __init__(self, rows: list[dict]):
        """rows: {artwork_id, kind, text, embedding (list or np.ndarray)} — already filtered to one model/dim."""
        self.rows = rows
        self.matrix = (
            np.vstack([np.asarray(r["embedding"], dtype=np.float32) for r in rows]) if rows else np.zeros((0, 1), np.float32)
        )
        self.by_artwork: dict[int, dict[str, list[int]]] = {}
        for i, r in enumerate(rows):
            self.by_artwork.setdefault(r["artwork_id"], {"whole": [], "situation": [], "avoid": []})[r["kind"]].append(i)

    def __len__(self) -> int:
        return len(self.rows)

    def rank(
        self,
        query: np.ndarray,
        catalogue: list[CatalogueItem],
        *,
        weight_situation: float,
        avoid_threshold: float,
        sensitive_penalty: float,
        limit: int = 5,
    ) -> list[Ranked]:
        sims = self.matrix @ query
        out: list[Ranked] = []
        for item in catalogue:  # only artworks the repository shows (approved, or pending in dev)
            idx = self.by_artwork.get(item.id)
            if not idx or not idx["situation"]:
                continue
            if idx["avoid"] and float(sims[idx["avoid"]].max()) >= avoid_threshold:
                continue
            situation_sims = sims[idx["situation"]]
            best = int(np.argmax(situation_sims))
            whole = float(sims[idx["whole"]].max()) if idx["whole"] else float(situation_sims[best])
            score = weight_situation * float(situation_sims[best]) + (1 - weight_situation) * whole
            if item.is_sensitive:
                score *= sensitive_penalty
            out.append(Ranked(item.id, score, self.rows[idx["situation"][best]]["text"]))
        out.sort(key=lambda r: r.score, reverse=True)
        return out[:limit]


def load_rows(settings: Settings) -> list[dict]:
    """Vectors for the configured model/dim: from Supabase in supabase mode, else the local file."""
    if settings.data_backend == "supabase":
        key = settings.supabase_service_key
        r = httpx.get(
            f"{settings.supabase_url.rstrip('/')}/rest/v1/artwork_embeddings",
            params={
                "select": "artwork_id,kind,text,embedding",
                "model": f"eq.{settings.embedding_model}",
                "dim": f"eq.{settings.embedding_dim}",
                "limit": 100000,
            },
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=30,
        )
        r.raise_for_status()
        rows = r.json()
        for row in rows:  # PostgREST returns pgvector values as the string "[0.1,0.2,...]"
            if isinstance(row["embedding"], str):
                row["embedding"] = json.loads(row["embedding"])
        return rows
    path = settings.embeddings_file
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("model") != settings.embedding_model or data.get("dim") != settings.embedding_dim:
        log.warning("%s holds %s/%s, config wants %s/%s — re-run embed_artworks.py", path, data.get("model"),
                    data.get("dim"), settings.embedding_model, settings.embedding_dim)
        return []
    return data["rows"]


def default_position(item: CatalogueItem | None) -> Position:
    return item.caption_position if item and item.caption_position in ("top", "bottom") else "bottom"
