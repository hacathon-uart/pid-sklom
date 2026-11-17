"""JSON-file repository. Reads data/seed/*.json (same columns as the DB tables).

Content team: edit the seed files (or regenerate them from the Google Sheet) and restart
the backend — no code changes needed. Memes are kept in backend/media/memes.json.
"""

import base64
import json
import random
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.config import Settings
from app.data.repository import CatalogueItem
from app.schemas import (
    ArtistDetail,
    ArtistRef,
    ArtistSummary,
    ArtworkDetail,
    ArtworkPage,
    ArtworkSummary,
    Fact,
    Meme,
    MemeCreate,
    MemeUpdate,
    Story,
)


def _load(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def visible_statuses(settings: Settings) -> set[str]:
    """Which artworks.review_status values users (and the AI) may see. «rejected» never."""
    return {"approved", "pending"} if settings.include_unreviewed else {"approved"}


def mood_text(profile: dict) -> str:
    mood = profile.get("mood") or []
    return ", ".join(mood) if isinstance(mood, list) else str(mood)


class LocalRepository:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.artists = {a["id"]: a for a in _load(settings.seed_dir / "artists.json")}
        shown = visible_statuses(settings)
        self.artworks = {
            a["id"]: a
            for a in _load(settings.seed_dir / "artworks.json")
            if a.get("review_status", "approved") in shown
        }
        self.facts = [
            f
            for f in _load(settings.seed_dir / "facts.json")
            if f.get("verified") and (f.get("artwork_id") is None or f["artwork_id"] in self.artworks)
        ]
        self.memes_dir = settings.media_dir / "memes"
        self.memes_file = settings.media_dir / "memes.json"
        self.memes: dict[str, dict] = _load(self.memes_file) if self.memes_file.exists() else {}

    # ---------- helpers ----------

    def _url(self, path: str | None) -> str | None:
        if not path or path.startswith("http"):
            return path
        return f"{self.settings.public_base_url}/static/{path}"

    def _artist_ref(self, a: dict) -> ArtistRef:
        return ArtistRef(
            id=a["id"],
            slug=a["slug"],
            name=a["name_uk"],
            birth_year=a.get("birth_year"),
            death_year=a.get("death_year"),
            portrait_url=self._url(a.get("portrait_url")),
        )

    def _artist_summary(self, a: dict) -> ArtistSummary:
        return ArtistSummary(**self._artist_ref(a).model_dump(), short_bio=a.get("short_bio", ""))

    def _artwork_summary(self, w: dict) -> ArtworkSummary:
        return ArtworkSummary(
            id=w["id"],
            slug=w["slug"],
            title=w["title_uk"],
            year=w.get("year"),
            genre=w.get("genre"),
            image_url=self._url(w["image_url"]),
            thumb_url=self._url(w.get("thumb_url") or w["image_url"]),
            artist=self._artist_ref(self.artists[w["artist_id"]]),
        )

    @staticmethod
    def _fact(f: dict) -> Fact:
        return Fact(id=f["id"], text=f["text_uk"], source_url=f.get("source_url"))

    # ---------- content ----------

    def list_artists(self) -> list[ArtistSummary]:
        return [self._artist_summary(a) for a in self.artists.values()]

    def get_artist(self, slug: str) -> ArtistDetail | None:
        a = next((a for a in self.artists.values() if a["slug"] == slug), None)
        if a is None:
            return None
        works = [w for w in self.artworks.values() if w["artist_id"] == a["id"]]
        featured = next((w for w in works if w.get("is_featured")), works[0] if works else None)
        return ArtistDetail(
            **self._artist_summary(a).model_dump(),
            birth_place=a.get("birth_place"),
            long_bio=a.get("long_bio", ""),
            sources=a.get("sources", []),
            facts=[self._fact(f) for f in self.facts if f.get("artist_id") == a["id"]],
            featured_artwork=self._artwork_summary(featured) if featured else None,
            artworks=[self._artwork_summary(w) for w in works],
        )

    def list_artworks(self, q=None, genre=None, artist_slug=None, limit=50, offset=0) -> ArtworkPage:
        items = list(self.artworks.values())
        if genre:
            items = [w for w in items if w.get("genre") == genre]
        if artist_slug:
            items = [w for w in items if self.artists[w["artist_id"]]["slug"] == artist_slug]
        if q:
            needle = q.lower()

            def haystack(w: dict) -> str:
                profile = w.get("meme_profile") or {}
                return " ".join(
                    [w["title_uk"], self.artists[w["artist_id"]]["name_uk"], mood_text(profile)]
                    + w.get("tags", [])
                ).lower()

            items = [w for w in items if needle in haystack(w)]
        return ArtworkPage(
            items=[self._artwork_summary(w) for w in items[offset : offset + limit]],
            total=len(items),
        )

    def get_artwork(self, artwork_id: int) -> ArtworkDetail | None:
        w = self.artworks.get(artwork_id)
        if w is None:
            return None
        facts = [self._fact(f) for f in self.facts if f.get("artwork_id") == artwork_id]
        artist_facts = [self._fact(f) for f in self.facts if f.get("artist_id") == w["artist_id"]]
        return ArtworkDetail(
            **self._artwork_summary(w).model_dump(),
            museum=w.get("museum"),
            medium=w.get("medium"),
            about=w.get("about_uk", ""),
            license=w.get("license"),
            source_url=w.get("source_url"),
            tags=w.get("tags", []),
            facts=facts,
            artist_facts=artist_facts,
            story=Story(
                museum=w.get("museum"),
                about_artwork=w.get("about_uk", ""),
                artwork_fact=facts[0] if facts else None,
                artist_fact=artist_facts[0] if artist_facts else None,
                source_url=w.get("source_url"),
            ),
        )

    def random_artwork(self) -> ArtworkSummary:
        return self._artwork_summary(random.choice(list(self.artworks.values())))

    def catalogue(self) -> list[CatalogueItem]:
        out = []
        for w in self.artworks.values():
            profile = w.get("meme_profile") or {}
            out.append(
                CatalogueItem(
                    id=w["id"],
                    title=w["title_uk"],
                    tags=w.get("tags", []),
                    situations=profile.get("meme_situations", []),
                    mood=mood_text(profile),
                    is_sensitive=w.get("is_sensitive", False),
                    do_not_use_for=profile.get("do_not_use_for") or [],
                    meme_potential=w.get("meme_potential"),
                    caption_position=profile.get("caption_position"),
                )
            )
        return out

    def fallback_captions(self, artwork_id: int) -> list[str]:
        return self.artworks.get(artwork_id, {}).get("fallback_captions", [])

    # ---------- memes ----------

    def _persist(self) -> None:
        self.memes_file.parent.mkdir(parents=True, exist_ok=True)
        self.memes_file.write_text(json.dumps(self.memes, ensure_ascii=False, indent=1), "utf-8")

    def _save_png(self, meme_id: str, data_url: str) -> str:
        _, _, b64 = data_url.partition(",")
        self.memes_dir.mkdir(parents=True, exist_ok=True)
        (self.memes_dir / f"{meme_id}.png").write_bytes(base64.b64decode(b64))
        stamp = int(datetime.now(UTC).timestamp())  # cache-buster after edits
        return f"{self.settings.public_base_url}/media/memes/{meme_id}.png?v={stamp}"

    def _meme(self, row: dict) -> Meme:
        return Meme(
            id=row["id"],
            artwork=self._artwork_summary(self.artworks[row["artwork_id"]]),
            caption=row["style"]["blocks"][0]["text"],
            style=row["style"],
            image_url=row.get("image_url"),
            is_favorite=row.get("is_favorite", False),
            created_at=row["created_at"],
        )

    def list_memes(self, user_id: str, favorite: bool | None = None) -> list[Meme]:
        # Skip memes whose artwork is hidden now (e.g. its profile was rejected after review).
        rows = [m for m in self.memes.values() if m["user_id"] == user_id and m["artwork_id"] in self.artworks]
        if favorite is not None:
            rows = [m for m in rows if m.get("is_favorite", False) == favorite]
        rows.sort(key=lambda m: m["created_at"], reverse=True)
        return [self._meme(m) for m in rows]

    def get_meme(self, meme_id: str):
        row = self.memes.get(meme_id)
        if not row or row["artwork_id"] not in self.artworks:
            return None
        return self._meme(row), row["user_id"]

    def create_meme(self, user_id: str, data: MemeCreate) -> Meme:
        if data.artwork_id not in self.artworks:
            raise KeyError(data.artwork_id)
        meme_id = str(uuid.uuid4())
        row = {
            "id": meme_id,
            "user_id": user_id,
            "artwork_id": data.artwork_id,
            "style": data.style.model_dump(),
            "image_url": self._save_png(meme_id, data.image_data_url) if data.image_data_url else None,
            "is_favorite": False,
            "created_at": datetime.now(UTC).isoformat(),
        }
        self.memes[meme_id] = row
        self._persist()
        return self._meme(row)

    def update_meme(self, meme_id: str, data: MemeUpdate) -> Meme:
        row = self.memes[meme_id]
        if data.style is not None:
            row["style"] = data.style.model_dump()
        if data.image_data_url:
            row["image_url"] = self._save_png(meme_id, data.image_data_url)
        if data.is_favorite is not None:
            row["is_favorite"] = data.is_favorite
        self._persist()
        return self._meme(row)

    def delete_meme(self, meme_id: str) -> None:
        self.memes.pop(meme_id, None)
        (self.memes_dir / f"{meme_id}.png").unlink(missing_ok=True)
        self._persist()
