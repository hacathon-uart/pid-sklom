"""API contract. These models ARE the JSON formats (see docs/API.md).

Frontend mirror: frontend/src/api/types.ts — change both in the same PR.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Position = Literal["top", "middle", "bottom"]
# Gallery filter tags: Портрет / Пейзаж / Побут / Авангард
Genre = Literal["portrait", "landscape", "everyday", "avantgarde"]
# Labels on screen 3c: Щодня / Робота / З історії картини
CaptionKind = Literal["everyday", "work", "story"]
Source = Literal["ai", "fallback"]


# ---------- Content ----------


class Fact(BaseModel):
    id: int
    text: str
    source_url: str | None = None


class ArtistRef(BaseModel):
    """Minimal artist info embedded in artworks and stories."""

    id: int
    slug: str
    name: str
    birth_year: int | None = None
    death_year: int | None = None
    portrait_url: str | None = None


class ArtistSummary(ArtistRef):
    """AuthorCard in the gallery / artists list."""

    short_bio: str = ""


class ArtworkSummary(BaseModel):
    """ArtworkCard in grids."""

    id: int
    slug: str
    title: str
    year: int | None = None
    genre: Genre | None = None
    image_url: str
    thumb_url: str
    artist: ArtistRef


class Story(BaseModel):
    """Everything the StoryCard shows besides the artwork header."""

    museum: str | None = None
    about_artwork: str = ""  # «Про картину»
    artwork_fact: Fact | None = None  # «Несподіваний факт»
    artist_fact: Fact | None = None  # «Про автора»
    source_url: str | None = None  # «Джерело: …»


class ArtworkDetail(ArtworkSummary):
    museum: str | None = None
    medium: str | None = None  # «полотно, олія»
    about: str = ""
    license: str | None = None
    source_url: str | None = None
    tags: list[str] = []
    facts: list[Fact] = []  # verified facts about this artwork
    artist_facts: list[Fact] = []  # verified facts about its artist
    story: Story  # default StoryCard content (first verified facts)


class ArtistDetail(ArtistSummary):
    birth_place: str | None = None
    long_bio: str = ""
    sources: list[str] = []
    facts: list[Fact] = []
    featured_artwork: ArtworkSummary | None = None
    artworks: list[ArtworkSummary] = []


class ArtworkPage(BaseModel):
    items: list[ArtworkSummary]
    total: int


# ---------- Flow A: phrase -> painting ----------


class MatchRequest(BaseModel):
    phrase: str = Field(min_length=1, max_length=200)  # becomes the caption
    description: str | None = Field(default=None, max_length=500)  # «Опис зображення», optional


class MatchCandidate(BaseModel):
    artwork: ArtworkSummary
    score: float | None = None  # 0..1, shown as «збіг 95%»; None = hide


class MatchResult(BaseModel):
    artwork: ArtworkSummary
    story: Story
    caption: str
    position: Position
    reason: str  # one line, why it fits (debug / optional UI)
    alternatives: list[MatchCandidate]  # Top-5, first one is the chosen artwork
    source: Source


# ---------- Flow B: painting -> caption ----------


class CaptionsRequest(BaseModel):
    artwork_id: int
    exclude: list[str] = []  # captions already shown («Ще варіанти»)


class CaptionOption(BaseModel):
    text: str
    kind: CaptionKind


class CaptionsResult(BaseModel):
    artwork_id: int
    captions: list[CaptionOption]
    source: Source


# ---------- Memes ----------


class TextBlock(BaseModel):
    """One caption block. Shared by the browser editor and the Pillow renderer.

    Coordinates are relative to the image (0..1) so they survive resizing.
    `size` is in px for an image REFERENCE_WIDTH (600) px wide.
    If x/y are null the block is placed by `position`.
    """

    text: str = Field(max_length=200)
    font: str = "Oswald"
    size: int = Field(default=40, ge=8, le=200)
    color: str = "#FFFFFF"
    outline: bool = True
    position: Position = "bottom"
    x: float | None = Field(default=None, ge=0, le=1)
    y: float | None = Field(default=None, ge=0, le=1)
    width: float | None = Field(default=None, gt=0, le=1)


class MemeStyle(BaseModel):
    blocks: list[TextBlock] = Field(min_length=1, max_length=2)


class MemeCreate(BaseModel):
    artwork_id: int
    style: MemeStyle
    image_data_url: str | None = None  # PNG exported by the browser editor (data:image/png;base64,...)


class MemeUpdate(BaseModel):
    style: MemeStyle | None = None
    image_data_url: str | None = None
    is_favorite: bool | None = None


class Meme(BaseModel):
    id: str
    artwork: ArtworkSummary
    caption: str  # = style.blocks[0].text
    style: MemeStyle
    image_url: str | None = None
    is_favorite: bool = False
    created_at: datetime
