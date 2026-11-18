from fastapi import APIRouter, Header

from app import operations
from app.config import get_settings

router = APIRouter(tags=["auth"])


@router.post("/guest")
def guest(x_guest_token: str | None = Header(default=None)):
    settings = get_settings()
    if not (settings.guest_limit_enabled or settings.guest_export_limit_enabled):
        return {"enabled": False, "token": None, "remaining": None, "exports_remaining": None}
    token = x_guest_token or operations.issue_guest()
    actor = operations.guest_actor(token)
    return {
        "enabled": True, "token": token,
        "remaining": operations.remaining(actor) if settings.guest_limit_enabled else None,
        "exports_remaining": operations.export_remaining(actor) if settings.guest_export_limit_enabled else None,
    }
