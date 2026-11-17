"""The one interface the rest of the backend uses to read/write data.

Two implementations:
  local_repo.LocalRepository       — data/seed/*.json, memes in backend/media (default, offline)
  supabase_repo.SupabaseRepository — Supabase Postgres + Storage (owner: A, T04/T11)
"""

from dataclasses import dataclass, field
from typing import Protocol

from app.schemas import (
    ArtistDetail,
    ArtistSummary,
    ArtworkDetail,
    ArtworkPage,
    ArtworkSummary,
    Meme,
    MemeCreate,
    MemeUpdate,
)


@dataclass
class CatalogueItem:
    """Compact per-artwork info sent to the AI for matching (~25 tokens each).

    Built from artworks.meme_profile (format: docs/adr/0001-artwork-data-storage.md).
    """

    id: int
    title: str
    tags: list[str]
    situations: list[str]  # meme_profile.meme_situations — the main matching signal
    mood: str = ""  # meme_profile.mood joined with ", "
    is_sensitive: bool = False  # tragic / religious work: no jokes
    do_not_use_for: list[str] = field(default_factory=list)
    meme_potential: int | None = None  # 1–5
    caption_position: str | None = None  # "top" | "bottom", suggested by the profile


class Repository(Protocol):
    # --- content (read-only) ---
    def list_artists(self) -> list[ArtistSummary]: ...
    def get_artist(self, slug: str) -> ArtistDetail | None: ...
    def list_artworks(
        self,
        q: str | None = None,
        genre: str | None = None,
        artist_slug: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> ArtworkPage: ...
    def get_artwork(self, artwork_id: int) -> ArtworkDetail | None: ...
    def random_artwork(self) -> ArtworkSummary: ...
    def catalogue(self) -> list[CatalogueItem]: ...
    def fallback_captions(self, artwork_id: int) -> list[str]: ...
    def situations(self, artwork_id: int) -> list[str]: ...

    # --- memes (per user) ---
    def list_memes(self, user_id: str, favorite: bool | None = None) -> list[Meme]: ...
    def get_meme(self, meme_id: str) -> tuple[Meme, str | None] | None:
        """Returns (meme, owner_user_id)."""
        ...
    def create_meme(self, user_id: str, data: MemeCreate, meme_id: str | None = None) -> Meme: ...
    def update_meme(self, meme_id: str, data: MemeUpdate) -> Meme: ...
    def delete_meme(self, meme_id: str) -> None: ...
