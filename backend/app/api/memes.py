"""Saved memes — «Мої меми» (US-08). Login required except reading a meme by its link."""

import logging
from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, Depends, Header, HTTPException, Response

from app import operations
from app.auth import User, current_user, optional_user
from app.config import get_settings
from app.data import get_repo
from app.png import png_bytes
from app.schemas import Meme, MemeCreate, MemeUpdate

router = APIRouter(prefix="/memes", tags=["memes"])

log = logging.getLogger(__name__)


def _owned(meme_id: str, user: User) -> Meme:
    found = get_repo().get_meme(meme_id)
    if found is None or found[1] != user.id:
        raise HTTPException(404, "Мем не знайдено")
    return found[0]


def _check_png(data_url: str | None) -> None:
    if data_url:
        png_bytes(data_url)


@router.get("", response_model=list[Meme])
def list_memes(favorite: bool | None = None, user: User = Depends(current_user)):
    """Screen 4, newest first. «Улюблені» filter → ?favorite=true."""
    return [meme.model_copy(update={"can_edit": True}) for meme in get_repo().list_memes(user.id, favorite)]


@router.post("", response_model=Meme, status_code=201)
def create_meme(
    body: MemeCreate, user: User = Depends(current_user),
    idempotency_key: str | None = Header(default=None),
):
    """«Зберегти в «Мої меми»». Send the PNG exported by the editor as a data URL."""
    _check_png(body.image_data_url)
    operation = None
    if get_settings().auth_mode == "supabase":
        operation = operations.begin(
            f"user:{user.id}", idempotency_key, "save", body.model_dump(exclude={"image_data_url"}), False
        )
        if operation["status"] == "complete":
            return {**operation["response"], "can_edit": True}
    try:
        meme_id = str(uuid5(NAMESPACE_URL, f"pidsklom:{user.id}:{operation['request_id']}")) if operation else None
        meme = get_repo().create_meme(user.id, body, meme_id)
        if operation:
            operations.finish(operation, meme.model_dump(mode="json"))
        return meme.model_copy(update={"can_edit": True})
    except Exception as error:
        if operation:
            try:
                operations.finish(operation, None, False)
            except HTTPException:
                log.error("Failed to release save reservation; lease will expire")
        if isinstance(error, KeyError):
            raise HTTPException(404, "Картину не знайдено") from error
        raise


@router.get("/{meme_id}", response_model=Meme)
def get_meme(meme_id: str, user: User | None = Depends(optional_user)):
    """Screen 4b. Readable by anyone with the link (ids are UUIDs) — for share links (US-16)."""
    found = get_repo().get_meme(meme_id)
    if found is None:
        raise HTTPException(404, "Мем не знайдено")
    return found[0].model_copy(update={"can_edit": bool(user and found[1] == user.id)})


@router.patch("/{meme_id}", response_model=Meme)
def update_meme(meme_id: str, body: MemeUpdate, user: User = Depends(current_user)):
    """Edit caption/style (4b «Редагувати») or toggle the heart (is_favorite)."""
    _owned(meme_id, user)
    _check_png(body.image_data_url)
    return get_repo().update_meme(meme_id, body).model_copy(update={"can_edit": True})


@router.delete("/{meme_id}", status_code=204)
def delete_meme(meme_id: str, user: User = Depends(current_user)):
    _owned(meme_id, user)
    get_repo().delete_meme(meme_id)
    return Response(status_code=204)
