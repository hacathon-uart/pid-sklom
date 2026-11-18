"""Who is calling. Login is only required for saving memes and the profile.

AUTH_MODE=stub      -> header "Authorization: Bearer <anything>" makes <anything> the user id.
AUTH_MODE=supabase  -> the frontend sends the Supabase access token; we verify it here.
AUTH_MODE=disabled  -> account operations are unavailable; public reads remain available.
"""

from dataclasses import dataclass
from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import Header, HTTPException

from app.config import get_settings


@dataclass
class User:
    id: str
    email: str | None = None


@lru_cache(maxsize=4)
def _jwks(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json", timeout=10)


def _user_from_token(token: str) -> User:
    settings = get_settings()
    if settings.auth_mode == "stub":
        return User(id=token or "dev-user")
    try:
        algorithm = settings.supabase_jwt_algorithm
        key = settings.supabase_jwt_secret if algorithm == "HS256" else _jwks(
            settings.supabase_url
        ).get_signing_key_from_jwt(token).key
        payload = jwt.decode(
            token, key, algorithms=[algorithm], audience="authenticated",
            issuer=f"{settings.supabase_url.rstrip('/')}/auth/v1",
            options={"require": ["sub", "exp", "iss", "aud"]},
        )
        user_id = str(UUID(payload["sub"]))
        if payload.get("is_anonymous"):
            raise ValueError("Anonymous Auth identities cannot save memes")
    except jwt.PyJWKClientConnectionError as e:
        raise HTTPException(503, "Не вдалося перевірити сесію. Спробуйте ще раз") from e
    except (jwt.PyJWTError, ValueError, TypeError) as e:
        raise HTTPException(401, "Сесія недійсна, увійдіть ще раз") from e
    return User(id=user_id, email=payload.get("email"))


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
