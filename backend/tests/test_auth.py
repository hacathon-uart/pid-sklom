import time
from types import SimpleNamespace
from uuid import uuid4

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException

from app import auth, operations
from app.config import Settings


@pytest.fixture
def signed_identity(monkeypatch):
    settings = Settings(
        _env_file=None, auth_mode="supabase", data_backend="supabase",
        supabase_url="https://project.supabase.co", supabase_service_key="server",
    )
    monkeypatch.setattr(auth, "get_settings", lambda: settings)
    key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(auth, "_jwks", lambda _: SimpleNamespace(
        get_signing_key_from_jwt=lambda _: SimpleNamespace(key=key.public_key())
    ))
    claims = {
        "sub": str(uuid4()), "exp": int(time.time()) + 600,
        "iss": "https://project.supabase.co/auth/v1", "aud": "authenticated",
    }
    return settings, key, claims


def test_jwks_identity_and_claim_validation(signed_identity):
    _, key, claims = signed_identity
    assert auth._user_from_token(jwt.encode(claims, key, algorithm="ES256")).id == claims["sub"]
    for changed in (
        {"iss": "https://other.supabase.co/auth/v1"}, {"aud": "other"},
        {"exp": 1}, {"sub": "not-a-uuid"}, {"is_anonymous": True},
    ):
        with pytest.raises(HTTPException) as error:
            auth._user_from_token(jwt.encode({**claims, **changed}, key, algorithm="ES256"))
        assert error.value.status_code == 401
    with pytest.raises(HTTPException):
        auth._user_from_token(jwt.encode(claims, "wrong" * 10, algorithm="HS256"))
    claims.pop("exp")
    with pytest.raises(HTTPException):
        auth._user_from_token(jwt.encode(claims, key, algorithm="ES256"))


def test_legacy_hs256_and_jwks_outage(signed_identity, monkeypatch):
    settings, _, claims = signed_identity
    settings.supabase_jwt_algorithm = "HS256"
    settings.supabase_jwt_secret = "a" * 64
    token = jwt.encode(claims, settings.supabase_jwt_secret, algorithm="HS256")
    assert auth._user_from_token(token).id == claims["sub"]
    settings.supabase_jwt_algorithm = "ES256"

    def unavailable(_):
        raise jwt.PyJWKClientConnectionError("offline")

    monkeypatch.setattr(auth, "_jwks", unavailable)
    with pytest.raises(HTTPException) as error:
        auth._user_from_token(token)
    assert error.value.status_code == 503


def test_guest_token_cannot_be_forged_or_used_as_login(monkeypatch):
    settings = Settings(_env_file=None, guest_token_secret="secret" * 8)
    monkeypatch.setattr(operations, "get_settings", lambda: settings)
    token = operations.issue_guest()
    assert operations.guest_actor(token).startswith("guest:")
    with pytest.raises(HTTPException):
        operations.guest_actor(token[:-1] + ("0" if token[-1] != "0" else "1"))
    settings.guest_token_secret = "other" * 8
    with pytest.raises(HTTPException):
        operations.guest_actor(token)


def test_operation_store_fails_closed_without_logging_credentials(monkeypatch, caplog):
    settings = Settings(_env_file=None, supabase_url="https://example.test", supabase_service_key="private-value")
    monkeypatch.setattr(operations, "get_settings", lambda: settings)
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503, request=request)))
    monkeypatch.setattr(operations, "_http", lambda: client)
    with pytest.raises(HTTPException) as error:
        operations.remaining("guest:test")
    assert error.value.status_code == 503
    assert "private-value" not in caplog.text
