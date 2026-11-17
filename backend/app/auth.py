"""Who is calling. Login is only required for saving memes and the profile.

AUTH_MODE=stub      -> header "Authorization: Bearer <anything>" makes <anything> the user id.
AUTH_MODE=supabase  -> the frontend sends the Supabase access token; we verify it here.
AUTH_MODE=disabled  -> account operations are unavailable; public reads remain available.
"""

from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException

from app.config import get_settings


@dataclass
class User:
    id: str
    email: str | None = None


def _user_from_token(token: str) -> User:
    settings = get_settings()
    if settings.auth_mode == "stub":
        return User(id=token or "dev-user")
    # TODO(A, T22): newer Supabase projects may sign with asymmetric keys (JWKS) instead of
    # the legacy HS256 secret — check Project Settings → API → JWT and adjust.
    try:
        payload = jwt.decode(
            token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated"
        )
    except jwt.PyJWTError as e:
        raise HTTPException(401, "Сесія недійсна, увійдіть ще раз") from e
    return User(id=payload["sub"], email=payload.get("email"))


def _token(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def current_user(authorization: str | None = Header(default=None)) -> User:
    if get_settings().auth_mode == "disabled":
        raise HTTPException(403, "Збереження в акаунт поки недоступне. Завантажте мем як PNG")
    token = _token(authorization)
    if token is None:
        raise HTTPException(401, "Увійдіть, щоб зберегти мем")
    return _user_from_token(token)


def optional_user(authorization: str | None = Header(default=None)) -> User | None:
    if get_settings().auth_mode == "disabled":
        return None
    token = _token(authorization)
    return _user_from_token(token) if token else None
