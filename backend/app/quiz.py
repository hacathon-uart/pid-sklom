"""Art quizzes (ADR 0008): «Хто автор?», «Пари», «Назва картини».

The backend builds every question and checks every answer. Run state travels in a signed,
short-lived token, so no table stores runs; only a signed-in visitor's best score is persisted.
The browser sees images and answer options only: no artwork ids, titles or artists of the shown
paintings until it answers.
"""

import base64
import hashlib
import hmac
import json
import random
import secrets
import time
from dataclasses import dataclass
from functools import lru_cache

from fastapi import HTTPException

from app.config import get_settings
from app.data import get_repo
from app.schemas import (
    ArtworkSummary,
    QuizGame,
    QuizImage,
    QuizOption,
    QuizQuestion,
    QuizScope,
)

GUEST_LIMITS: dict[str, int] = {"who": 5, "pairs": 1, "titles": 5}
OPTIONS = 4  # answer options in «Хто автор?» and «Назва картини»
PAIRS = 3  # paintings (and artists) per «Пари» round
SCOPE_MIN = 4  # an artist needs this many artworks to be a «Назва картини» scope
TOKEN_TTL_S = 6 * 3600


# ---------- catalogue ----------


@dataclass
class Catalogue:
    artworks: list[ArtworkSummary]
    birth: dict[int, int | None]  # artist id -> birth year

    @property
    def by_id(self) -> dict[int, ArtworkSummary]:
        return {w.id: w for w in self.artworks}

    def artists(self) -> dict[int, str]:
        return {w.artist.id: w.artist.name for w in self.artworks}

    def in_scope(self, scope: str) -> list[ArtworkSummary]:
        return self.artworks if scope == "all" else [w for w in self.artworks if w.artist.slug == scope]


def catalogue() -> Catalogue:
    """The published set, exactly as the gallery shows it (the repository already hides unreviewed works)."""
    repo = get_repo()
    page = repo.list_artworks(limit=100_000)
    return Catalogue(page.items, {a.id: a.birth_year for a in repo.list_artists()})


def _distinct_titles(works: list[ArtworkSummary]) -> int:
    return len({w.title.casefold() for w in works})


def title_scopes(cat: Catalogue) -> list[QuizScope]:
    scopes = [QuizScope(key="all", name="Усі картини", artworks=len(cat.artworks))] if _distinct_titles(cat.artworks) >= OPTIONS else []
    by_artist: dict[str, list[ArtworkSummary]] = {}
    for w in cat.artworks:
        by_artist.setdefault(w.artist.slug, []).append(w)
    for slug, works in sorted(by_artist.items(), key=lambda item: item[1][0].artist.name):
        if len(works) >= SCOPE_MIN and _distinct_titles(works) >= OPTIONS:
            scopes.append(QuizScope(key=slug, name=works[0].artist.name, artworks=len(works)))
    return scopes


def available_games(cat: Catalogue) -> list[QuizGame]:
    games: list[QuizGame] = []
    artists = len(cat.artists())
    if artists >= OPTIONS:
        games.append("who")
    if artists >= PAIRS:
        games.append("pairs")
    if title_scopes(cat):
        games.append("titles")
    return games


# ---------- run token ----------


@lru_cache
def _secret() -> bytes:
    settings = get_settings()
    # A dedicated secret is not required: runs are not money. Without any configured secret
    # (local development) a per-process one is used and runs simply restart after a reload.
    return (settings.quiz_token_secret or settings.guest_token_secret or secrets.token_hex(32)).encode()


def _sign(body: bytes) -> str:
    return hmac.new(_secret(), body, hashlib.sha256).hexdigest()


def encode(state: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(state, separators=(",", ":")).encode()).decode()
    return f"{body}.{_sign(body.encode())}"


def decode(token: str, user_id: str | None) -> dict:
    body, _, signature = token.partition(".")
    if not signature or not hmac.compare_digest(signature, _sign(body.encode())):
        raise HTTPException(400, detail={"code": "quiz_restart", "message": "Гру перервано. Почніть нову"})
    state = json.loads(base64.urlsafe_b64decode(body.encode()))
    if state["exp"] < time.time():
        raise HTTPException(409, detail={"code": "quiz_restart", "message": "Гра застаріла. Почніть нову"})
    if state["u"] != (user_id or ""):
        # Signing in or out mid-run starts a new run (ADR 0008): guest scores are never carried over.
        raise HTTPException(409, detail={"code": "quiz_restart", "message": "Ви увійшли чи вийшли з акаунта. Почніть нову гру"})
    return state


def new_state(game: str, scope: str, user_id: str | None, limited: bool) -> dict:
    return {"g": game, "s": scope, "u": user_id or "", "l": limited, "sc": 0, "seen": [], "q": None,
            "exp": int(time.time()) + TOKEN_TTL_S}


# ---------- questions ----------


def _nearby_artists(cat: Catalogue, artist_id: int, count: int) -> list[int]:
    """Wrong artist options: prefer artists of a similar generation, with some randomness."""
    born = cat.birth.get(artist_id)
    others = [a for a in cat.artists() if a != artist_id]

    def distance(a: int) -> float:
        b = cat.birth.get(a)
        gap = abs(b - born) if born is not None and b is not None else 60
        return gap + random.uniform(0, 40)

    return sorted(others, key=distance)[:count]


def _title_options(cat: Catalogue, scope: str, answer: ArtworkSummary) -> list[int]:
    """Wrong title options: same artist first (harder), then the rest of the scope."""
    pool = cat.in_scope(scope)
    same = [w for w in pool if w.artist.id == answer.artist.id and w.id != answer.id]
    rest = [w for w in pool if w.artist.id != answer.artist.id]
    random.shuffle(same)
    random.shuffle(rest)
    chosen: list[int] = []
    titles = {answer.title.casefold()}
    for w in same + rest:
        if len(chosen) == OPTIONS - 1:
            break
        if w.title.casefold() not in titles:
            titles.add(w.title.casefold())
            chosen.append(w.id)
    return chosen


def next_question(state: dict, cat: Catalogue) -> QuizQuestion | None:
    """Builds the next question into `state["q"]`; None when the catalogue (or scope) is exhausted."""
    seen = set(state["seen"])
    game = state["g"]
    if game == "pairs":
        unseen = [w for w in cat.artworks if w.id not in seen]
        random.shuffle(unseen)
        picked: list[ArtworkSummary] = []
        for w in unseen:
            if w.artist.id not in {p.artist.id for p in picked}:
                picked.append(w)
            if len(picked) == PAIRS:
                break
        if len(picked) < PAIRS:
            return None
        artists = [w.artist.id for w in picked]
        random.shuffle(artists)
        state["q"] = {"imgs": [w.id for w in picked], "opts": artists}
        names = cat.artists()
        return QuizQuestion(
            images=[QuizImage(key=str(i), image_url=w.image_url) for i, w in enumerate(picked)],
            options=[QuizOption(key=str(i), label=names[a]) for i, a in enumerate(artists)],
        )

    pool = [w for w in cat.in_scope(state["s"]) if w.id not in seen]
    if not pool:
        return None
    answer = random.choice(pool)
    if game == "who":
        options = [answer.artist.id, *_nearby_artists(cat, answer.artist.id, OPTIONS - 1)]
        random.shuffle(options)
        names = cat.artists()
        labels = [names[a] for a in options]
    else:
        options = [answer.id, *_title_options(cat, state["s"], answer)]
        random.shuffle(options)
        by_id = cat.by_id
        labels = [by_id[w].title for w in options]
    state["q"] = {"imgs": [answer.id], "opts": options}
    return QuizQuestion(
        images=[QuizImage(key="0", image_url=answer.image_url)],
        options=[QuizOption(key=str(i), label=label) for i, label in enumerate(labels)],
    )


def right_option(state: dict, cat: Catalogue, artwork_id: int) -> int:
    """Index of the right option for one shown painting."""
    options = state["q"]["opts"]
    if state["g"] == "titles":
        return options.index(artwork_id)
    return options.index(cat.by_id[artwork_id].artist.id)


def fact_for(artwork_id: int) -> str:
    """One reviewed line to learn from: an artwork fact, an artist fact, or the start of its story."""
    detail = get_repo().get_artwork(artwork_id)
    if detail is None:
        return ""
    story = detail.story
    if story.artwork_fact:
        return story.artwork_fact.text
    if story.artist_fact:
        return story.artist_fact.text
    about = story.about_artwork.strip()
    first = about.split(". ")[0]
    return first if first.endswith(".") or not about else f"{first}."
