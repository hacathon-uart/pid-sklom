import httpx
import pytest

from app.data.supabase_repo import SupabaseRepository
from app.schemas import MemeCreate, MemeStyle, TextBlock


def repository(handler):
    repo = object.__new__(SupabaseRepository)
    repo.base = "https://storage.example.test"
    repo.http = httpx.Client(transport=httpx.MockTransport(handler))
    repo.artworks = {1: {}}
    return repo


def test_delete_checks_storage_before_removing_row():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(503 if len(calls) == 1 else 200, json=[])

    repo = repository(handler)
    with pytest.raises(httpx.HTTPStatusError):
        repo.delete_meme("meme")
    assert len(calls) == 1
    assert calls[0].method == "DELETE"
    assert calls[0].url.path == "/storage/v1/object/memes"
    assert calls[0].content == b'{"prefixes": ["meme.png"]}'
    repo.delete_meme("meme")
    assert calls[-1].url.path == "/rest/v1/memes"


def test_failed_create_cleans_uploaded_png_but_uncertain_commit_keeps_it():
    calls = []

    def handler(request):
        calls.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=[])
        if request.url.path == "/rest/v1/memes":
            return httpx.Response(500)
        return httpx.Response(200, json=[])

    repo = repository(handler)
    body = MemeCreate(artwork_id=1, style=MemeStyle(blocks=[TextBlock(text="test")]),
                      image_data_url="data:image/png;base64,aGVsbG8=")
    with pytest.raises(httpx.HTTPStatusError):
        repo.create_meme("user", body, "deterministic")
    assert calls[-1].method == "DELETE" and calls[-1].url.path == "/storage/v1/object/memes"

    def uncertain(request):
        if request.method == "POST" and request.url.path == "/rest/v1/memes":
            raise httpx.ReadTimeout("response lost", request=request)
        return handler(request)

    calls.clear()
    repo = repository(uncertain)
    with pytest.raises(httpx.ReadTimeout):
        repo.create_meme("user", body, "deterministic")
    assert not any(request.method == "DELETE" for request in calls)
