"""Art quizzes (ADR 0008). Public: guests play a short version, signed-in visitors keep best scores."""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app import quiz
from app.auth import User, optional_user
from app.config import get_settings
from app.data import get_repo
from app.schemas import QuizAnswer, QuizInfo, QuizResult, QuizReveal, QuizRun, QuizStart

router = APIRouter(prefix="/quiz", tags=["quiz"])
log = logging.getLogger(__name__)


def _best(user: User) -> dict[str, int] | None:
    # Best scores are a nicety: if their store is unavailable (e.g. migration 0003 not applied yet),
    # the games still work and the scores simply are not shown or kept.
    try:
        return get_repo().quiz_best(user.id)
    except httpx.HTTPError as error:
        log.warning("Quiz best scores unavailable (%s)", type(error).__name__)
        return None


def _record(user: User, key: str, score: int) -> tuple[int | None, bool]:
    try:
        return get_repo().record_quiz_score(user.id, key, score)
    except httpx.HTTPError as error:
        log.warning("Quiz best score not recorded (%s)", type(error).__name__)
        return None, False


def _limited(user: User | None) -> bool:
    # Without accounts there is nothing to sign in for, so nobody gets the short version.
    return user is None and get_settings().auth_mode != "disabled"


def _key(game: str, scope: str) -> str:
    return f"titles:{scope}" if game == "titles" else game


@router.get("", response_model=QuizInfo)
def info(user: User | None = Depends(optional_user)):
    """Which games and «Назва картини» scopes the catalogue can fill, and the caller's best scores."""
    cat = quiz.catalogue()
    return QuizInfo(
        games=quiz.available_games(cat),
        title_scopes=quiz.title_scopes(cat),
        artworks=len(cat.artworks),
        limited=_limited(user),
        guest_limits=quiz.GUEST_LIMITS,
        best=_best(user) if user else None,
    )


@router.post("/runs", response_model=QuizRun, status_code=201)
def start(body: QuizStart, user: User | None = Depends(optional_user)):
    cat = quiz.catalogue()
    if body.game not in quiz.available_games(cat):
        raise HTTPException(409, "Для цієї гри поки замало картин")
    limited = _limited(user)
    scope = "all" if body.game != "titles" else body.scope
    if body.game == "titles":
        if limited and scope != "all":
            raise HTTPException(403, "Гра за окремим автором доступна після входу")
        if scope not in {s.key for s in quiz.title_scopes(cat)}:
            raise HTTPException(404, "Такого автора у вікторині немає")
    state = quiz.new_state(body.game, scope, user.id if user else None, limited)
    question = quiz.next_question(state, cat)
    return QuizRun(token=quiz.encode(state), score=0, limit=_limit(state), question=question)


def _limit(state: dict) -> int | None:
    return quiz.GUEST_LIMITS[state["g"]] if state["l"] else None


@router.post("/runs/answer", response_model=QuizResult)
def answer(body: QuizAnswer, user: User | None = Depends(optional_user)):
    state = quiz.decode(body.token, user.id if user else None)
    if not state["q"]:
        raise HTTPException(409, detail={"code": "quiz_restart", "message": "Гру завершено. Почніть нову"})
    cat = quiz.catalogue()
    by_id = cat.by_id
    shown: list[int] = state["q"]["imgs"]
    if any(w not in by_id for w in shown):
        # The painting was unpublished mid-run.
        raise HTTPException(409, detail={"code": "quiz_restart", "message": "Каталог оновився. Почніть нову гру"})

    single = len(shown) == 1
    reveals: list[QuizReveal] = []
    for index, artwork_id in enumerate(shown):
        image_key = str(index)
        chosen = body.answer.get("answer" if single else image_key)
        right = str(quiz.right_option(state, cat, artwork_id))
        reveals.append(QuizReveal(
            image_key=image_key, correct=chosen == right, chosen=chosen, right=right,
            artwork=by_id[artwork_id], fact=quiz.fact_for(artwork_id),
        ))
    correct = all(r.correct for r in reveals)

    state["seen"] = [*state["seen"], *shown]
    state["q"] = None
    finished = None
    question = None
    if not correct:
        finished = "mistake"
    else:
        state["sc"] += 1
        limit = _limit(state)
        if limit is not None and state["sc"] >= limit:
            finished = "guest_limit"
        else:
            question = quiz.next_question(state, cat)
            if question is None:
                finished = "complete"

    best, new_record = None, False
    if finished and user:
        best, new_record = _record(user, _key(state["g"], state["s"]), state["sc"])
    run = QuizRun(
        token=None if finished else quiz.encode(state), score=state["sc"], limit=_limit(state), question=question,
    )
    return QuizResult(correct=correct, reveals=reveals, run=run, finished=finished, best=best, new_record=new_record)
