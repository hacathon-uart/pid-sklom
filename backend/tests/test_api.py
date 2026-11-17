"""Smoke tests for the API contract (run: cd backend && pytest)."""

import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os

    os.environ["MEDIA_DIR"] = str(tmp_path_factory.mktemp("media"))
    from app.config import get_settings

    get_settings.cache_clear()
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


AUTH = {"Authorization": "Bearer test-user"}


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/api/ready").json()["status"] == "ready"


def test_content(client):
    artists = client.get("/api/artists").json()
    assert artists
    detail = client.get(f"/api/artists/{artists[0]['slug']}").json()
    assert detail["artworks"] and detail["featured_artwork"]

    page = client.get("/api/artworks", params={"genre": "landscape"}).json()
    assert page["total"] >= 1 and all(w["genre"] == "landscape" for w in page["items"])

    art = client.get(f"/api/artworks/{page['items'][0]['id']}").json()
    assert "story" in art and art["artist"]["name"]
    assert client.get("/api/artworks/999999").status_code == 404
    # unverified facts are never shown
    assert all("неперевірений" not in f["text"] for f in client.get("/api/artworks/8").json()["facts"])


def test_match(client):
    r = client.post("/api/matches", json={"phrase": "коли дедлайн завтра"})
    assert r.status_code == 201
    body = r.json()
    assert body["caption"] == "коли дедлайн завтра"
    assert 1 <= len(body["alternatives"]) <= 5
    assert body["alternatives"][0]["artwork"]["id"] == body["artwork"]["id"]
    assert client.post("/api/matches", json={"phrase": ""}).status_code == 422


def test_captions(client):
    body = client.post("/api/artworks/1/captions", json={}).json()
    assert len(body["captions"]) == 3
    again = client.post("/api/artworks/1/captions", json={"exclude": [c["text"] for c in body["captions"]]}).json()
    assert not {c["text"] for c in again["captions"]} & {c["text"] for c in body["captions"]}


def _png_data_url() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_memes_crud(client):
    assert client.get("/api/memes").status_code == 401
    style = {"blocks": [{"text": "Привіт ґєії"}]}
    created = client.post("/api/memes", headers=AUTH,
                          json={"artwork_id": 1, "style": style, "image_data_url": _png_data_url()})
    assert created.status_code == 201
    meme = created.json()
    assert meme["caption"] == "Привіт ґєії" and meme["image_url"]

    assert [m["id"] for m in client.get("/api/memes", headers=AUTH).json()] == [meme["id"]]
    fav = client.patch(f"/api/memes/{meme['id']}", headers=AUTH, json={"is_favorite": True}).json()
    assert fav["is_favorite"] is True
    assert len(client.get("/api/memes", headers=AUTH, params={"favorite": True}).json()) == 1

    other = {"Authorization": "Bearer someone-else"}
    assert client.delete(f"/api/memes/{meme['id']}", headers=other).status_code == 404
    assert client.delete(f"/api/memes/{meme['id']}", headers=AUTH).status_code == 204
    assert client.get("/api/memes", headers=AUTH).json() == []


def test_accounts_disabled_rejects_fake_tokens_but_preserves_public_reads(client, monkeypatch):
    from app import auth
    from app.config import Settings

    monkeypatch.setattr(auth, "get_settings", lambda: Settings(_env_file=None, auth_mode="disabled"))
    requests = [
        ("GET", "/api/memes", None),
        ("POST", "/api/memes", {"artwork_id": 1, "style": {"blocks": [{"text": "test"}]}}),
        ("PATCH", "/api/memes/nonexistent", {"is_favorite": True}),
        ("DELETE", "/api/memes/nonexistent", None),
    ]
    for method, path, body in requests:
        for headers in ({}, AUTH):
            response = client.request(method, path, headers=headers, json=body)
            assert response.status_code == 403
    assert client.get("/api/artworks").status_code == 200
    assert client.get("/api/memes/nonexistent", headers=AUTH).status_code == 404


def test_cors_allows_only_configured_origins(client):
    for origin, allowed in (("http://localhost:5173", True), ("https://untrusted.vercel.app", False)):
        response = client.options(
            "/api/matches",
            headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
        )
        assert ("access-control-allow-origin" in response.headers) is allowed


@pytest.mark.parametrize(
    "overrides",
    [
        {"data_backend": "supabase"},
        {"ai_provider": "llm"},
        {"auth_mode": "supabase"},
        {"telegram_bot_token": "configured"},
        {"environment": "production"},
        {
            "environment": "production", "auth_mode": "disabled", "data_backend": "supabase",
            "supabase_url": "https://example.supabase.co", "supabase_service_key": "test",
            "public_base_url": "https://api.example.com", "frontend_origins": "*",
        },
    ],
)
def test_invalid_runtime_configuration_fails_explicitly(overrides):
    from app.config import Settings

    settings = Settings(
        _env_file=None,
        **{
            "data_backend": "local", "ai_provider": "stub", "auth_mode": "stub",
            "supabase_url": "", "supabase_service_key": "", "supabase_jwt_secret": "",
            "ai_api_key": "", "telegram_bot_token": "", "telegram_webhook_secret": "change-me",
            **overrides,
        },
    )
    with pytest.raises(RuntimeError):
        settings.validate_runtime()


def test_startup_rejects_empty_catalogue(monkeypatch):
    from types import SimpleNamespace

    from app import main

    monkeypatch.setattr(main, "get_repo", lambda: SimpleNamespace(catalogue=lambda: []))
    with pytest.raises(RuntimeError, match="No visible artworks"):
        with TestClient(main.app):
            pass
    assert TestClient(main.app).get("/api/ready").status_code == 503


@pytest.mark.parametrize("rows", [[], [{"artwork_id": 1, "kind": "situation", "text": "x", "embedding": [1.0]}]])
def test_startup_rejects_missing_or_incompatible_vectors(monkeypatch, rows):
    from app import ai, main
    from app.ai import llm
    from app.config import Settings

    settings = Settings(_env_file=None, ai_provider="llm", ai_api_key="test", embedding_dim=2)
    monkeypatch.setattr(main, "settings", settings)
    monkeypatch.setattr(llm, "load_rows", lambda _: rows)
    monkeypatch.setattr(ai, "get_ai", lambda: llm.LLMProvider(settings))
    with pytest.raises(RuntimeError, match="Missing or incompatible embeddings"):
        with TestClient(main.app):
            pass


@pytest.mark.parametrize("artwork_ids, succeeds", [([1], True), ([1, 2], False)])
def test_embedding_startup_requires_visible_catalogue_coverage(monkeypatch, artwork_ids, succeeds):
    from types import SimpleNamespace

    from app import ai, main
    from app.ai import llm
    from app.config import Settings

    settings = Settings(_env_file=None, ai_provider="llm", ai_api_key="test", embedding_dim=2)
    monkeypatch.setattr(main, "settings", settings)
    catalogue = [SimpleNamespace(id=artwork_id) for artwork_id in artwork_ids]
    monkeypatch.setattr(main, "get_repo", lambda: SimpleNamespace(catalogue=lambda: catalogue))
    monkeypatch.setattr(llm, "load_rows", lambda _: [
        {"artwork_id": 1, "kind": "situation", "text": "test", "embedding": [1.0, 0.0]},
    ])
    monkeypatch.setattr(ai, "get_ai", lambda: llm.LLMProvider(settings))
    if succeeds:
        with TestClient(main.app) as client:
            assert client.get("/api/ready").status_code == 200
    else:
        with pytest.raises(RuntimeError, match="missing situation embeddings"):
            with TestClient(main.app):
                pass


def test_renderer():
    from app.render.meme import render_meme
    from app.schemas import TextBlock

    buf = io.BytesIO()
    Image.new("RGB", (600, 400), "gray").save(buf, "PNG")
    png = render_meme(buf.getvalue(), [TextBlock(text="Коли ґава їсть"), TextBlock(text="верх", position="top")])
    assert Image.open(io.BytesIO(png)).size == (600, 400)


def test_review_status_hides_unreviewed_artworks(tmp_path):
    """Only approved artworks are shown; INCLUDE_UNREVIEWED adds pending ones, never rejected (ADR 0001).

    Uses its own seed files, so it keeps working when every real artwork has been reviewed.
    """
    import json

    from app.config import Settings
    from app.data.local_repo import LocalRepository

    artist = {"id": 1, "slug": "a", "name_uk": "Автор"}
    work = {"artist_id": 1, "image_url": "images/x.jpg", "tags": [], "meme_profile": {}}
    artworks = [
        {**work, "id": 1, "slug": "w1", "title_uk": "Схвалена", "review_status": "approved"},
        {**work, "id": 2, "slug": "w2", "title_uk": "Очікує", "review_status": "pending"},
        {**work, "id": 3, "slug": "w3", "title_uk": "Відхилена", "review_status": "rejected"},
    ]
    for name, rows in (("artists", [artist]), ("artworks", artworks), ("facts", [])):
        (tmp_path / f"{name}.json").write_text(json.dumps(rows), encoding="utf-8")

    live = LocalRepository(Settings(include_unreviewed=False, seed_dir=tmp_path))
    dev = LocalRepository(Settings(include_unreviewed=True, seed_dir=tmp_path))
    assert set(live.artworks) == {1}
    assert set(dev.artworks) == {1, 2}  # rejected stays hidden
    assert len(dev.catalogue()) > len(live.catalogue())


def test_catalogue_reads_full_meme_profile():
    from app.config import Settings
    from app.data.local_repo import LocalRepository

    items = LocalRepository(Settings(include_unreviewed=True)).catalogue()
    assert all(item.situations for item in items)
    assert all(isinstance(item.mood, str) and item.mood for item in items)
    assert any(item.is_sensitive for item in items)  # imported profiles carry the sensitivity flag


def test_embedding_index_scoring_rules():
    """ADR 0002: best situation wins, avoid rules drop an artwork, sensitive works rank lower."""
    import numpy as np

    from app.ai.matching import EmbeddingIndex
    from app.data.repository import CatalogueItem

    def v(*xs):
        a = np.array(xs, dtype=np.float32)
        return a / np.linalg.norm(a)

    rows = [
        {"artwork_id": 1, "kind": "whole", "text": "w1", "embedding": v(1, 1, 0)},
        {"artwork_id": 1, "kind": "situation", "text": "коли дедлайн", "embedding": v(1, 0, 0)},
        {"artwork_id": 2, "kind": "whole", "text": "w2", "embedding": v(1, 1, 0)},
        {"artwork_id": 2, "kind": "situation", "text": "схоже", "embedding": v(1, 0.1, 0)},
        {"artwork_id": 3, "kind": "whole", "text": "w3", "embedding": v(1, 0, 0)},
        {"artwork_id": 3, "kind": "situation", "text": "точно", "embedding": v(1, 0, 0)},
        {"artwork_id": 3, "kind": "avoid", "text": "не про дедлайни", "embedding": v(1, 0, 0.1)},
    ]
    cat = [CatalogueItem(id=i, title=str(i), tags=[], situations=[]) for i in (1, 2, 3)]
    cat[1].is_sensitive = True
    query = v(1, 0, 0)
    kw = dict(weight_situation=0.7, avoid_threshold=0.8, sensitive_penalty=0.9)

    ranked = EmbeddingIndex(rows).rank(query, cat, **kw)
    assert [r.artwork_id for r in ranked] == [1, 2]  # 3 dropped by its avoid rule; 2 penalised
    assert ranked[0].reason == "коли дедлайн"
    assert EmbeddingIndex(rows).rank(query, cat[:2], **kw)[0].artwork_id == 1  # only catalogue items count
