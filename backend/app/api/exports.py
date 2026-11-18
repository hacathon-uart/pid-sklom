"""Reserve and finish a distinct guest PNG export without storing the image."""

from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel, Field

from app import operations
from app.auth import User, optional_user
from app.config import get_settings
from app.png import MAX_PNG_DATA_URL, png_fingerprint

router = APIRouter(prefix="/exports", tags=["exports"])


class ExportRequest(BaseModel):
    artwork_id: int = Field(gt=0)
    image_data_url: str = Field(max_length=MAX_PNG_DATA_URL)


class ExportFinish(BaseModel):
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    lease: UUID
    success: bool


def _request_id(actor: str, fingerprint: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"pidsklom:export:{actor}:{fingerprint}"))


def _remaining(actor: str, response: Response) -> int:
    remaining = operations.export_remaining(actor)
    response.headers["X-Guest-Exports-Remaining"] = str(remaining)
    return remaining


@router.post("")
def authorize_export(
    body: ExportRequest, response: Response,
    user: User | None = Depends(optional_user), x_guest_token: str | None = Header(default=None),
):
    if user or not get_settings().guest_export_limit_enabled:
        return {"enabled": False, "remaining": None}
    actor = operations.guest_actor(x_guest_token)
    fingerprint = png_fingerprint(body.image_data_url, body.artwork_id)
    operation = operations.begin(
        actor, _request_id(actor, fingerprint), "export", {"fingerprint": fingerprint}, True,
    )
    return {
        "enabled": True, "fingerprint": fingerprint,
        "lease": operation["lease"] if operation["status"] == "started" else None,
        "remaining": _remaining(actor, response),
    }


@router.post("/finish")
def finish_export(
    body: ExportFinish, response: Response,
    user: User | None = Depends(optional_user), x_guest_token: str | None = Header(default=None),
):
    if user or not get_settings().guest_export_limit_enabled:
        return {"remaining": None}
    actor = operations.guest_actor(x_guest_token)
    operations.finish({
        "actor": actor, "request_id": _request_id(actor, body.fingerprint), "lease": str(body.lease),
    }, {"fingerprint": body.fingerprint}, body.success)
    return {"remaining": _remaining(actor, response)}
