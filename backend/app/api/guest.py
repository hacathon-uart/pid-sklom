from fastapi import APIRouter, Header

from app import operations
from app.config import get_settings

router = APIRouter(tags=["auth"])


@router.post("/guest")
def guest(x_guest_token: str | None = Header(default=None)):
    if not get_settings().guest_limit_enabled:
        return {"enabled": False, "token": None, "remaining": None}
    token = x_guest_token or operations.issue_guest()
    actor = operations.guest_actor(token)
    return {"enabled": True, "token": token, "remaining": operations.remaining(actor)}
