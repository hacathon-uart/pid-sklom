"""Supabase-backed repository (owner: A — T04, T11, T23).

Content (artists, artworks, facts) is small, so it is read once at startup from the Postgres
tables and then served from memory by the same code as LocalRepository. Restart the backend
after approving artworks or re-running data/scripts/upload_to_supabase.py.

Memes are stored in the `memes` table; their PNGs go to the public Storage bucket «memes».
The backend uses the service key and does its own ownership checks (see api/memes.py).
Talks to Supabase over plain HTTP (httpx), so no extra package is needed.
"""

import base64
import uuid
from datetime import UTC, datetime

import httpx

from app.config import Settings
from app.data.local_repo import LocalRepository
from app.schemas import Meme, MemeCreate, MemeUpdate

# Explicit list, so new heavy columns are never pulled by accident. Vectors: artwork_embeddings.
ARTWORK_COLUMNS = (
    "id,wikidata_id,slug,artist_id,title_uk,year,museum,medium,genre,about_uk,image_url,thumb_url,"
    "license,source_url,is_featured,tags,meme_profile,review_status,is_sensitive,meme_potential,"
    "fallback_captions,embedding_text"
)
MEMES_BUCKET = "memes"


class SupabaseRepository(LocalRepository):
    def __init__(self, settings: Settings):
        if not settings.supabase_url or not settings.supabase_service_key:
            raise RuntimeError("DATA_BACKEND=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY")
        self.settings = settings
        self.base = settings.supabase_url.rstrip("/")
        key = settings.supabase_service_key
        self.http = httpx.Client(headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=20)
        self._set_content(
            self._select("artists"),
            self._select("artworks", select=ARTWORK_COLUMNS),
            self._select("facts"),
        )

    # ---------- HTTP helpers ----------

    def _select(self, table: str, select: str = "*", **filters: str) -> list[dict]:
        r = self.http.get(f"{self.base}/rest/v1/{table}", params={"select": select, "limit": 5000, **filters})
        r.raise_for_status()
        return r.json()

    def _meme_rows(self, **filters: str) -> list[dict]:
        r = self.http.get(f"{self.base}/rest/v1/memes", params={"select": "*", **filters})
        if r.status_code == 400:  # e.g. an id that is not a valid uuid
            return []
        r.raise_for_status()
        return r.json()

    # ---------- memes ----------

    def _save_png(self, meme_id: str, data_url: str) -> str:
        _, _, b64 = data_url.partition(",")
        r = self.http.post(
            f"{self.base}/storage/v1/object/{MEMES_BUCKET}/{meme_id}.png",
            content=base64.b64decode(b64),
            headers={"Content-Type": "image/png", "x-upsert": "true"},
        )
        r.raise_for_status()
        stamp = int(datetime.now(UTC).timestamp())  # cache-buster after edits
        return f"{self.base}/storage/v1/object/public/{MEMES_BUCKET}/{meme_id}.png?v={stamp}"

    def _delete_png(self, meme_id: str) -> None:
        self.http.request(
            "DELETE", f"{self.base}/storage/v1/object/{MEMES_BUCKET}",
            json={"prefixes": [f"{meme_id}.png"]},
        ).raise_for_status()

    def list_memes(self, user_id: str, favorite: bool | None = None) -> list[Meme]:
        filters = {"user_id": f"eq.{user_id}", "order": "created_at.desc"}
        if favorite is not None:
            filters["is_favorite"] = f"eq.{str(favorite).lower()}"
        rows = [m for m in self._meme_rows(**filters) if m["artwork_id"] in self.artworks]
        return [self._meme(m) for m in rows]

    def get_meme(self, meme_id: str):
        rows = self._meme_rows(id=f"eq.{meme_id}")
        if not rows or rows[0]["artwork_id"] not in self.artworks:
            return None
        return self._meme(rows[0]), rows[0]["user_id"]

    def create_meme(self, user_id: str, data: MemeCreate, meme_id: str | None = None) -> Meme:
        if data.artwork_id not in self.artworks:
            raise KeyError(data.artwork_id)
        meme_id = meme_id or str(uuid.uuid4())
        existing = self.get_meme(meme_id)
        if existing:
            if existing[1] != user_id:
                raise RuntimeError("Meme identity collision")
            return existing[0]
        style = data.style.model_dump()
        row = {
            "id": meme_id,
            "user_id": user_id,
            "artwork_id": data.artwork_id,
            "caption": style["blocks"][0]["text"],
            "style": style,
            "image_url": self._save_png(meme_id, data.image_data_url) if data.image_data_url else None,
        }
        try:
            r = self.http.post(
                f"{self.base}/rest/v1/memes", json=row, headers={"Prefer": "return=representation"}
            )
            r.raise_for_status()
        except httpx.HTTPStatusError:
            existing = self.get_meme(meme_id)
            if existing and existing[1] == user_id:
                return existing[0]
            if row["image_url"]:
                self._delete_png(meme_id)
            raise
        return self._meme(r.json()[0])

    def update_meme(self, meme_id: str, data: MemeUpdate) -> Meme:
        patch: dict = {}
        if data.style is not None:
            patch["style"] = data.style.model_dump()
            patch["caption"] = patch["style"]["blocks"][0]["text"]
        if data.image_data_url:
            patch["image_url"] = self._save_png(meme_id, data.image_data_url)
        if data.is_favorite is not None:
            patch["is_favorite"] = data.is_favorite
        if not patch:
            return self._meme(self._meme_rows(id=f"eq.{meme_id}")[0])
        r = self.http.patch(
            f"{self.base}/rest/v1/memes",
            params={"id": f"eq.{meme_id}"},
            json=patch,
            headers={"Prefer": "return=representation"},
        )
        r.raise_for_status()
        return self._meme(r.json()[0])

    def delete_meme(self, meme_id: str) -> None:
        self._delete_png(meme_id)
        self.http.delete(f"{self.base}/rest/v1/memes", params={"id": f"eq.{meme_id}"}).raise_for_status()

    # ---------- quiz best scores (data/migrations/0003_quiz_best_scores.sql) ----------

    def quiz_best(self, user_id: str) -> dict[str, int]:
        r = self.http.get(
            f"{self.base}/rest/v1/quiz_best_scores",
            params={"select": "quiz_key,best_score", "user_id": f"eq.{user_id}"},
        )
        r.raise_for_status()
        return {row["quiz_key"]: row["best_score"] for row in r.json()}

    def record_quiz_score(self, user_id: str, key: str, score: int) -> tuple[int, bool]:
        r = self.http.post(
            f"{self.base}/rest/v1/rpc/quiz_record_score",
            json={"p_user_id": user_id, "p_quiz_key": key, "p_score": score},
        )
        r.raise_for_status()
        row = r.json()
        return row["best_score"], row["new_record"]
