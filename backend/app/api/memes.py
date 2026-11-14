"""Saved memes — «Мої меми» (US-08). Login required except reading a meme by its link."""

from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import User, current_user, optional_user
from app.data import get_repo
from app.schemas import Meme, MemeCreate, MemeUpdate

router = APIRouter(prefix="/memes", tags=["memes"])

MAX_PNG_DATA_URL = 8 * 1024 * 1024  # ~6 MB PNG


def _owned(meme_id: str, user: User) -> Meme:
    found = get_repo().get_meme(meme_id)
    if found is None or found[1] != user.id:
        raise HTTPException(404, "Мем не знайдено")
    return found[0]


def _check_png(data_url: str | None) -> None:
    if data_url and (not data_url.startswith("data:image/png;base64,") or len(data_url) > MAX_PNG_DATA_URL):
        raise HTTPException(422, "Очікуємо PNG до 6 МБ")


@router.get("", response_model=list[Meme])
def list_memes(favorite: bool | None = None, user: User = Depends(current_user)):
    """Screen 4, newest first. «Улюблені» filter → ?favorite=true."""
    return get_repo().list_memes(user.id, favorite)


@router.post("", response_model=Meme, status_code=201)
def create_meme(body: MemeCreate, user: User = Depends(current_user)):
    """«Зберегти в «Мої меми»». Send the PNG exported by the editor as a data URL."""
    _check_png(body.image_data_url)
    try:
        return get_repo().create_meme(user.id, body)
    except KeyError as e:
        raise HTTPException(404, "Картину не знайдено") from e


@router.get("/{meme_id}", response_model=Meme)
def get_meme(meme_id: str, user: User | None = Depends(optional_user)):
    """Screen 4b. Readable by anyone with the link (ids are UUIDs) — for share links (US-16)."""
    found = get_repo().get_meme(meme_id)
    if found is None:
        raise HTTPException(404, "Мем не знайдено")
    return found[0]


@router.patch("/{meme_id}", response_model=Meme)
def update_meme(meme_id: str, body: MemeUpdate, user: User = Depends(current_user)):
    """Edit caption/style (4b «Редагувати») or toggle the heart (is_favorite)."""
    _owned(meme_id, user)
    _check_png(body.image_data_url)
    return get_repo().update_meme(meme_id, body)


@router.delete("/{meme_id}", status_code=204)
def delete_meme(meme_id: str, user: User = Depends(current_user)):
    _owned(meme_id, user)
    get_repo().delete_meme(meme_id)
    return Response(status_code=204)
