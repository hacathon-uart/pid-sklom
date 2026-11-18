"""Review page for one artist: approve / edit / reject paintings, facts and biography, then publish.

    backend/.venv/bin/python data/scripts/review_server.py --artist mykola-pymonenko

Opens http://127.0.0.1:8765 (only this computer can reach it). Every click is saved straight into
the drafts (data/artwork_drafts/, data/facts_drafts/, data/bio_drafts/), so you can close the page
and come back later. «Опублікувати» then runs, in order:
  1. approved paintings -> data/artworks_meme_descriptions.json (review.status = approved);
  2. import_profiles.py      -> data/seed/artworks.json
  3. process_images.py       -> data/images/<slug>.jpg + thumbs
  4. extract_facts.py import -> data/seed/facts.json   (approved facts with a second source)
  5. extract_bio.py import   -> data/seed/artists.json (+ portrait)
  6. embed_artworks.py --local-only, or — only if you tick «Supabase» — upload_to_supabase.py and
     embed_artworks.py, which write to the shared database the whole team uses.
"""

import argparse
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.responses import HTMLResponse, JSONResponse  # noqa: E402

from collect_paintings import draft_path as paintings_path  # noqa: E402
from extract_facts import DATA_DIR, SEED, Settings, load_json, save_json  # noqa: E402
from profile_artworks import embedding_text  # noqa: E402

SCRIPTS = Path(__file__).resolve().parent
PAGE = SCRIPTS / "review_page.html"
PROFILES = DATA_DIR / "artworks_meme_descriptions.json"
STATUSES = {"pending", "approved", "rejected"}
PROFILE_LISTS = ("mood", "meme_situations", "tags", "do_not_use_for")


def facts_path(slug: str) -> Path:
    return DATA_DIR / "facts_drafts" / f"{slug}.json"


def bio_path(slug: str) -> Path:
    return DATA_DIR / "bio_drafts" / f"{slug}.json"


def _status(value) -> str:
    if value not in STATUSES:
        raise HTTPException(400, f"status має бути одним із {sorted(STATUSES)}")
    return value


def _lines(value) -> list[str]:
    items = value.splitlines() if isinstance(value, str) else (value or [])
    return [str(x).strip() for x in items if str(x).strip()]


def merge_profiles(draft: dict, artist: dict, reviewer: str) -> tuple[int, int]:
    """Approved (and rejected) painting candidates -> the profile file that import_profiles.py reads."""
    profiles = load_json(PROFILES, [])
    by_qid = {p["artwork_id"]: p for p in profiles}
    approved = rejected = 0
    for c in draft.get("candidates", []):
        if not c.get("profile"):
            continue  # only paintings profiled by this pipeline; the team's older rows are left alone
        if c.get("status") == "approved":
            p = dict(c["profile"])
            p["title_uk"] = c.get("title_uk") or p["title_uk"]
            p["artist"] = artist["name_uk"]
            p["year"] = c.get("year")
            p["embedding_text"] = embedding_text(p)
            p["review"] = {"status": "approved", "reviewer": reviewer, "notes": c.get("note") or ""}
            by_qid[c["qid"]] = p
            approved += 1
        elif c.get("status") == "rejected" and c["qid"] in by_qid:
            by_qid[c["qid"]]["review"] = {**(by_qid[c["qid"]].get("review") or {}), "status": "rejected",
                                          "notes": c.get("note") or ""}
            rejected += 1
    order = [p["artwork_id"] for p in profiles] + [q for q in by_qid if q not in {p["artwork_id"] for p in profiles}]
    save_json(PROFILES, [by_qid[q] for q in order])
    return approved, rejected


class Publisher:
    """Runs the publish steps in a background thread and keeps a log the page polls."""

    def __init__(self):
        self.running = False
        self.log: list[str] = []
        self.result: str | None = None
        self.lock = threading.Lock()

    def say(self, line: str) -> None:
        with self.lock:
            self.log.append(line.rstrip())

    def step(self, script: str, *args: str) -> bool:
        self.say(f"\n$ python data/scripts/{script} {' '.join(args)}")
        proc = subprocess.Popen([sys.executable, str(SCRIPTS / script), *args], cwd=DATA_DIR.parent,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in proc.stdout:
            self.say("  " + line)
        ok = proc.wait() == 0
        if not ok:
            self.say(f"  ✗ {script} завершився з помилкою")
        return ok

    def start(self, artist: dict, supabase: bool, reviewer: str) -> None:
        with self.lock:
            if self.running:
                raise HTTPException(409, "Публікація вже йде")
            self.running, self.log, self.result = True, [], None
        threading.Thread(target=self._run, args=(artist, supabase, reviewer), daemon=True).start()

    def _run(self, artist: dict, supabase: bool, reviewer: str) -> None:
        try:
            ok = self._publish(artist, supabase, reviewer)
            self.result = "ok" if ok else "error"
        except Exception as exc:  # show it on the page instead of dying silently
            self.say(f"✗ {exc}")
            self.result = "error"
        finally:
            self.running = False

    def _publish(self, artist: dict, supabase: bool, reviewer: str) -> bool:
        draft = load_json(paintings_path(artist["slug"]), {})
        if draft:
            approved, rejected = merge_profiles(draft, artist, reviewer)
            self.say(f"Профілі: схвалено {approved}, відхилено {rejected} → {PROFILES.relative_to(DATA_DIR.parent)}")
            if not self.step("import_profiles.py"):
                return False
            if not self.step("process_images.py"):
                self.say("  (не страшно: такі картини поки показуються з Wikimedia; натисни «Опублікувати» ще раз пізніше)")
        if facts_path(artist["slug"]).exists() and not self.step("extract_facts.py", "import"):
            return False
        if bio_path(artist["slug"]).exists() and not self.step("extract_bio.py", "import"):
            return False
        if not Settings().ai_api_key:
            self.say("\nЕмбединги пропущено: немає AI_API_KEY у backend/.env.")
        elif not supabase and not self.step("embed_artworks.py", "--local-only"):
            return False
        if supabase:
            if not self.step("upload_to_supabase.py"):
                return False
            if Settings().ai_api_key and not self.step("embed_artworks.py"):
                return False
            self.say("\nSupabase оновлено. Перезапусти бекенд на Render, щоб він підхопив нові дані.")
        self.say("\n✓ Готово. Закоміть data/seed/*.json, data/images/, data/artworks_meme_descriptions.json.")
        return True


def create_app(slug: str) -> FastAPI:
    app = FastAPI(title="pid-sklom review")
    publisher = Publisher()

    def artist() -> dict:
        a = next((a for a in load_json(SEED / "artists.json", []) if a["slug"] == slug), None)
        if a is None:
            raise HTTPException(404, f"Художника {slug} немає в artists.json")
        return a

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        # The page changes files on disk: refuse requests that come via another host name (DNS rebinding).
        host = (request.headers.get("host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost", "testserver"):
            return JSONResponse({"detail": "лише локально"}, status_code=403)
        return await call_next(request)

    @app.get("/", response_class=HTMLResponse)
    def page():
        return PAGE.read_text(encoding="utf-8")

    @app.get("/api/state")
    def state():
        a = artist()
        seed_qids = {w.get("wikidata_id") for w in load_json(SEED / "artworks.json", [])}
        paintings = load_json(paintings_path(slug), {})
        for c in paintings.get("candidates", []):
            c["in_catalogue"] = c.get("in_catalogue") or c["qid"] in seed_qids
        return {
            "artist": a,
            "paintings": paintings,
            "facts": load_json(facts_path(slug), {}),
            "bio": load_json(bio_path(slug), {}),
            "publish": {"running": publisher.running, "result": publisher.result, "log": "\n".join(publisher.log)},
            "has_ai_key": bool(Settings().ai_api_key),
        }

    @app.post("/api/painting/{qid}")
    async def painting(qid: str, request: Request):
        body = await request.json()
        path = paintings_path(slug)
        draft = load_json(path, None)
        c = next((c for c in (draft or {}).get("candidates", []) if c["qid"] == qid), None)
        if c is None:
            raise HTTPException(404, f"Картини {qid} немає в чернетці")
        if "status" in body:
            c["status"] = _status(body["status"])
        for k in ("title_uk", "note"):
            if k in body:
                c[k] = str(body[k]).strip()
        if "year" in body:
            c["year"] = int(body["year"]) if str(body["year"]).strip().isdigit() else None
        if c.get("profile"):
            for k in PROFILE_LISTS:
                if k in body:
                    c["profile"][k] = _lines(body[k])
            if "visual_description" in body:
                c["profile"]["visual_description"] = str(body["visual_description"]).strip()
            if "is_sensitive" in body:
                c["profile"]["is_sensitive"] = bool(body["is_sensitive"])
        if c["status"] == "approved" and not c.get("profile"):
            raise HTTPException(400, "Без профілю картину не схвалити: спершу profile_artworks.py")
        save_json(path, draft)
        return c

    @app.post("/api/fact/{fact_id}")
    async def fact(fact_id: str, request: Request):
        body = await request.json()
        path = facts_path(slug)
        draft = load_json(path, None)
        f = next((f for f in (draft or {}).get("facts", []) if f["id"] == fact_id), None)
        if f is None:
            raise HTTPException(404, f"Факту {fact_id} немає в чернетці")
        if "status" in body:
            f["status"] = _status(body["status"])
        for k in ("text_uk", "second_source_url", "note"):
            if k in body:
                f[k] = str(body[k]).strip()
        if "interesting" in body:
            f["interesting"] = body["interesting"] if body["interesting"] in (True, False, None) else None
        save_json(path, draft)
        return f

    @app.post("/api/bio")
    async def bio(request: Request):
        body = await request.json()
        path = bio_path(slug)
        draft = load_json(path, None)
        if draft is None:
            raise HTTPException(404, "Чернетки біографії немає: спершу extract_bio.py extract")
        if "status" in body:
            draft["status"] = _status(body["status"])
        for k in ("birth_place", "short_bio", "long_bio", "note"):
            if k in body:
                draft[k] = str(body[k]).strip()
        draft["long_bio_words"] = len(draft.get("long_bio", "").split())
        if "portrait_use" in body and draft.get("portrait"):
            draft["portrait"]["use"] = body["portrait_use"] if body["portrait_use"] in (True, False, None) else None
        save_json(path, draft)
        return draft

    @app.post("/api/publish")
    async def publish(request: Request):
        body = await request.json()
        reviewer = str(body.get("reviewer") or "").strip()[:60]
        publisher.start(artist(), bool(body.get("supabase")), reviewer)
        return {"started": datetime.now(timezone.utc).isoformat(timespec="seconds")}

    return app


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--artist", required=True, help="slug з data/seed/artists.json")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="не відкривати браузер самостійно")
    args = parser.parse_args()
    if not any(a["slug"] == args.artist for a in load_json(SEED / "artists.json", [])):
        print(f"Художника {args.artist!r} немає в data/seed/artists.json")
        return 1
    import uvicorn

    url = f"http://127.0.0.1:{args.port}"
    print(f"Сторінка перевірки: {url}  (зупинити — Ctrl+C)")
    if not args.no_browser:
        threading.Thread(target=lambda: (time.sleep(1.2), webbrowser.open(url)), daemon=True).start()
    uvicorn.run(create_app(args.artist), host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
