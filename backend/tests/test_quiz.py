"""Quizzes (ADR 0008): server-checked answers, guest caps, best scores and token integrity."""

import pytest
from fastapi.testclient import TestClient

from app.data import get_repo

AUTH = {"Authorization": "Bearer quiz-user"}


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os

    os.environ["MEDIA_DIR"] = str(tmp_path_factory.mktemp("quiz-media"))
    from app.config import get_settings

    get_settings.cache_clear()
    get_repo.cache_clear()
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


def _solve(client, run, headers, game, scope="all"):
    """Answer correctly by looking the painting up the way a test may (by its image URL)."""
    from app import quiz

    cat = quiz.catalogue()
    by_image = {w.image_url: w for w in cat.artworks}
    question = run["question"]
    labels = {o["label"]: o["key"] for o in question["options"]}
    if game == "pairs":
        answer = {img["key"]: labels[by_image[img["image_url"]].artist.name] for img in question["images"]}
    else:
        work = by_image[question["images"][0]["image_url"]]
        answer = {"answer": labels[work.title if game == "titles" else work.artist.name]}
    return client.post("/api/quiz/runs/answer", json={"token": run["token"], "answer": answer}, headers=headers).json()


def _wrong(question):
    return {"answer": "wrong"} if len(question["images"]) == 1 else {img["key"]: "wrong" for img in question["images"]}


def test_info_lists_games_and_scopes(client):
    info = client.get("/api/quiz").json()
    assert set(info["games"]) == {"who", "pairs", "titles"}
    assert info["title_scopes"][0]["key"] == "all"
    assert info["artworks"] == info["title_scopes"][0]["artworks"] > 0
    assert info["limited"] is True and info["best"] is None
    assert info["guest_limits"] == {"who": 5, "pairs": 1, "titles": 5}
    signed_in = client.get("/api/quiz", headers=AUTH).json()
    assert signed_in["limited"] is False and signed_in["best"] == {}


def test_questions_hide_the_answer(client):
    run = client.post("/api/quiz/runs", json={"game": "who"}).json()
    question = run["question"]
    assert len(question["images"]) == 1 and len(question["options"]) == 4
    assert set(question["images"][0]) == {"key", "image_url"}
    assert len({o["label"] for o in question["options"]}) == 4
    titles = client.post("/api/quiz/runs", json={"game": "titles"}).json()["question"]
    assert len({o["label"].casefold() for o in titles["options"]}) == 4


def test_guest_who_stops_after_five(client):
    run = client.post("/api/quiz/runs", json={"game": "who"}).json()
    assert run["limit"] == 5
    for n in range(1, 6):
        result = _solve(client, run, {}, "who")
        assert result["correct"] and result["run"]["score"] == n
        assert result["reveals"][0]["artwork"]["title"]
        run = result["run"]
    assert result["finished"] == "guest_limit" and run["token"] is None and result["best"] is None


def test_wrong_answer_ends_the_run_and_reveals(client):
    run = client.post("/api/quiz/runs", json={"game": "titles"}).json()
    result = client.post("/api/quiz/runs/answer", json={"token": run["token"], "answer": _wrong(run["question"])}).json()
    assert result["correct"] is False and result["finished"] == "mistake"
    reveal = result["reveals"][0]
    assert reveal["chosen"] == "wrong" and reveal["right"] in {o["key"] for o in run["question"]["options"]}


def test_guest_pairs_is_one_round_of_three(client):
    run = client.post("/api/quiz/runs", json={"game": "pairs"}).json()
    question = run["question"]
    assert len(question["images"]) == 3 and len(question["options"]) == 3
    result = _solve(client, run, {}, "pairs")
    assert result["correct"] and result["finished"] == "guest_limit" and result["run"]["score"] == 1
    assert len(result["reveals"]) == 3


def test_guest_cannot_pick_an_artist_scope(client):
    scopes = client.get("/api/quiz").json()["title_scopes"]
    artist = next((s["key"] for s in scopes if s["key"] != "all"), None)
    if artist:
        assert client.post("/api/quiz/runs", json={"game": "titles", "scope": artist}).status_code == 403


def test_signed_in_runs_to_the_end_and_keeps_best(client):
    run = client.post("/api/quiz/runs", json={"game": "who"}, headers=AUTH).json()
    assert run["limit"] is None
    total = len(client.get("/api/artworks", params={"limit": 200}).json()["items"])
    while True:
        result = _solve(client, run, AUTH, "who")
        run = result["run"]
        if result["finished"]:
            break
    assert result["finished"] == "complete" and run["score"] == total
    assert result["best"] == total and result["new_record"] is True

    worse = client.post("/api/quiz/runs", json={"game": "who"}, headers=AUTH).json()
    lost = client.post("/api/quiz/runs/answer", json={"token": worse["token"], "answer": _wrong(worse["question"])},
                       headers=AUTH).json()
    assert lost["best"] == total and lost["new_record"] is False
    assert client.get("/api/quiz", headers=AUTH).json()["best"] == {"who": total}


def test_artist_scope_only_uses_that_artist(client):
    scopes = client.get("/api/quiz").json()["title_scopes"]
    artist = next((s for s in scopes if s["key"] != "all"), None)
    if artist is None:
        pytest.skip("No artist has enough artworks for a scope")
    run = client.post("/api/quiz/runs", json={"game": "titles", "scope": artist["key"]}, headers=AUTH).json()
    shown = 0
    while run["token"]:
        result = _solve(client, run, AUTH, "titles", artist["key"])
        assert result["reveals"][0]["artwork"]["artist"]["slug"] == artist["key"]
        shown += 1
        run = result["run"]
    assert shown == artist["artworks"] and result["finished"] == "complete"
    assert client.get("/api/quiz", headers=AUTH).json()["best"][f"titles:{artist['key']}"] == shown


def test_tampered_or_foreign_tokens_restart(client):
    run = client.post("/api/quiz/runs", json={"game": "who"}).json()
    body, _, signature = run["token"].partition(".")
    tampered = client.post("/api/quiz/runs/answer", json={"token": f"{body}x.{signature}", "answer": {}})
    assert tampered.status_code == 400 and tampered.json()["detail"]["code"] == "quiz_restart"
    # A guest run cannot be finished as a signed-in visitor (and vice versa).
    foreign = client.post("/api/quiz/runs/answer", json={"token": run["token"], "answer": {}}, headers=AUTH)
    assert foreign.status_code == 409 and foreign.json()["detail"]["code"] == "quiz_restart"


def test_unknown_scope_is_404(client):
    assert client.post("/api/quiz/runs", json={"game": "titles", "scope": "nobody"}, headers=AUTH).status_code == 404


def test_scoreless_run_is_not_a_record(client):
    headers = {"Authorization": "Bearer zero-user"}
    run = client.post("/api/quiz/runs", json={"game": "pairs"}, headers=headers).json()
    lost = client.post("/api/quiz/runs/answer", json={"token": run["token"], "answer": _wrong(run["question"])},
                       headers=headers).json()
    assert lost["finished"] == "mistake" and lost["best"] == 0 and lost["new_record"] is False
    assert client.get("/api/quiz", headers=headers).json()["best"] == {}


def test_games_work_when_score_storage_is_down(client, monkeypatch):
    import httpx

    repo = get_repo()

    def down(*_args, **_kwargs):
        raise httpx.ConnectError("no table yet")

    monkeypatch.setattr(repo, "quiz_best", down)
    monkeypatch.setattr(repo, "record_quiz_score", down)
    headers = {"Authorization": "Bearer storage-down"}
    assert client.get("/api/quiz", headers=headers).json()["best"] is None
    run = client.post("/api/quiz/runs", json={"game": "who"}, headers=headers).json()
    result = _solve(client, run, headers, "who")
    lost = client.post("/api/quiz/runs/answer", json={"token": result["run"]["token"], "answer": _wrong(result["run"]["question"])},
                       headers=headers).json()
    assert lost["finished"] == "mistake" and lost["run"]["score"] == 1 and lost["best"] is None
