"""Read-only content: artists, artworks (gallery, author page, painting picker)."""

from fastapi import APIRouter, HTTPException, Query

from app.data import get_repo
from app.schemas import ArtistDetail, ArtistSummary, ArtworkDetail, ArtworkPage, ArtworkSummary, Genre

router = APIRouter(tags=["content"])


@router.get("/artists", response_model=list[ArtistSummary])
def list_artists():
    """Gallery «Автори» row and the artists list page (US-09)."""
    return get_repo().list_artists()


@router.get("/artists/{slug}", response_model=ArtistDetail)
def get_artist(slug: str):
    """Author page 5b (US-10): long bio, facts, featured painting, all works."""
    artist = get_repo().get_artist(slug)
    if artist is None:
        raise HTTPException(404, "Автора не знайдено")
    return artist


@router.get("/artworks", response_model=ArtworkPage)
def list_artworks(
    q: str | None = Query(None, description="Search: artist, title, tag or mood"),
    genre: Genre | None = None,
    artist: str | None = Query(None, description="Artist slug"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Gallery 5 and painting picker 2b (US-14)."""
    return get_repo().list_artworks(q=q, genre=genre, artist_slug=artist, limit=limit, offset=offset)


@router.get("/artworks/random", response_model=ArtworkSummary)
def random_artwork():
    """«Випадкова картина» on 2b; bot /random."""
    return get_repo().random_artwork()


@router.get("/artworks/{artwork_id}", response_model=ArtworkDetail)
def get_artwork(artwork_id: int):
    """Artwork + default StoryCard content. Used by 3c/3d and when picking a Top-5 alternative."""
    artwork = get_repo().get_artwork(artwork_id)
    if artwork is None:
        raise HTTPException(404, "Картину не знайдено")
    return artwork
