"""Source texts -> draft «surprising facts» with verbatim quotes -> human review -> data/seed/facts.json.

Option 3 of the content plan: Gemini reads a real source (Ukrainian Wikipedia, ESU, a museum page)
and proposes facts, but every fact must carry an exact quote from that source. The script checks
the quote against the downloaded text and throws away every fact whose quote is not there, so the
model cannot slip in something the source does not say. What survives is a draft for a person.

1. Extract drafts for one artist (sources: the artist's and the paintings' uk.wikipedia articles,
   found through their wikidata_id, plus any --url / --text-file you add):

    backend/.venv/bin/python data/scripts/extract_facts.py extract --artist mykola-pymonenko
    backend/.venv/bin/python data/scripts/extract_facts.py extract --artist mykola-pymonenko \\
        --url https://esu.com.ua/article-XXXX
    # a site that blocks scripts: save the text by hand and give its address
    backend/.venv/bin/python data/scripts/extract_facts.py extract --artist mykola-pymonenko \\
        --text-file ~/esu_pymonenko.txt --text-url https://esu.com.ua/article-XXXX

   Drafts go to data/facts_drafts/<artist-slug>.json. Re-running adds new drafts and keeps
   everything you already reviewed.

2. Review in data/facts_drafts/<artist-slug>.json, for every fact:
     "status": "approved" | "rejected"         (default "pending")
     "second_source_url": "https://..."        another source that confirms it (required to approve)
     "interesting": true | false               is it worth showing? (only for the report)
     "text_uk": you may rewrite the wording; do not add anything the quote does not support.

3. See the validation numbers (goal: ≥8/10 true, ≥5/10 interesting):

    backend/.venv/bin/python data/scripts/extract_facts.py report

4. Copy approved facts into data/seed/facts.json as verified facts:

    backend/.venv/bin/python data/scripts/extract_facts.py import [--dry-run]

   A «ЗАГЛУШКА» placeholder fact of the same artist/painting is overwritten in place (same id),
   so upload_to_supabase.py replaces it in the database too. Then run upload_to_supabase.py.

Needs AI_API_KEY (and optionally AI_MODEL) in backend/.env for `extract`.
"""

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DATA_DIR.parent / "backend"))

import httpx  # noqa: E402

from app.ai.gemini import RateLimited, generate_json  # noqa: E402
from app.config import Settings  # noqa: E402

SEED = DATA_DIR / "seed"
DRAFTS_DIR = DATA_DIR / "facts_drafts"
PLACEHOLDER = "ЗАГЛУШКА"
# Wikimedia asks for a descriptive User-Agent. Generic project name only, no personal data.
USER_AGENT = "PidSklomDataBot/0.1 (educational hackathon project; public-domain paintings)"
MAX_SOURCE_CHARS = 60_000
MIN_QUOTE_CHARS = 25
KINDS = ["model", "creation", "fate", "hidden_detail", "life", "recognition", "other"]

SYSTEM = """Ти — дослідниця української мистецької історії для застосунку мемів з картин.
Твоє завдання — знайти в наданому тексті джерела факти, які здивують звичайну людину.

Жорсткі правила:
- Використовуй ТІЛЬКИ наданий текст. Нічого не додавай від себе, навіть якщо знаєш.
- До кожного факту дай `quote` — дослівний неперервний фрагмент тексту джерела (1–2 речення),
  скопійований символ у символ, без скорочень, без «...», без перефразування.
- `text_uk` — 1–2 речення живою українською, лише те, що підтверджує цитата.
  Усі числа й роки в `text_uk` мають бути в цитаті.
- Факт про конкретну картину з переліку прив'язуй до її artwork_id, лише якщо її назва є в цитаті.
- Факт про художника (about = "artist") формулюй з ним у центрі: починай з прізвища художника,
  а не з «Картину «…»». Такий факт показують поруч з будь-якою його картиною.
- Пропускай банальне: дати народження, «навчався в школі», загальні оцінки на кшталт «видатний художник».
- Шукай: хто позував для картини; як і де її створено; що з нею сталося потім (продаж, виставки,
  втрата, копії, нагороди); прихована деталь; дивні чи смішні епізоди з життя; несподівані зв'язки.
Відповідай JSON-об'єктом."""

PROMPT = """Художник: {artist}
Картини цього художника (artwork_id: назва, рік):
{artworks}

Джерело: {source_url}
Текст джерела:
<<<
{text}
>>>

Знайди до {n} найнесподіваніших фактів. Формат:
{{"facts": [{{
  "text_uk": "...",
  "quote": "дослівна цитата з тексту",
  "about": "artist" або artwork_id з переліку вище (напр. "Q12345"), якщо факт саме про цю картину,
  "kind": одне з {kinds},
  "interest": 1-5 (наскільки здивує звичайну людину),
  "why": "чому це цікаво, 1 коротке речення"
}}]}}
Якщо цікавих фактів немає — поверни {{"facts": []}}."""


# ---------- text helpers ----------

_QUOTES = str.maketrans({"«": '"', "»": '"', "“": '"', "”": '"', "„": '"', "’": "'", "ʼ": "'", "`": "'",
                         "–": "-", "—": "-", " ": " ", "­": None, "​": None})


def normalise(s: str) -> str:
    """Make a quote and the source comparable: same quotes/dashes/apostrophes, collapsed spaces."""
    s = s.translate(_QUOTES)
    s = re.sub(r"\[\d+\]", "", s)  # wiki footnote marks [12]
    return re.sub(r"\s+", " ", s).strip().casefold()


def numbers(s: str) -> set[str]:
    return set(re.findall(r"\d+", s))


def fact_id(quote: str, about) -> str:
    return hashlib.sha1(f"{about}|{normalise(quote)}".encode()).hexdigest()[:12]


class _TextFromHtml(HTMLParser):
    SKIP = {"script", "style", "nav", "header", "footer", "noscript", "svg", "form"}

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in ("p", "br", "li", "h1", "h2", "h3", "h4", "tr", "div"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    p = _TextFromHtml()
    p.feed(html)
    return re.sub(r"\n\s*\n+", "\n\n", "".join(p.parts)).strip()


# ---------- sources ----------

def wiki_get(client: httpx.Client, url: str, params: dict) -> dict:
    """GET a Wikimedia API, waiting out HTTP 429 (they throttle bursts of script requests)."""
    for attempt in range(5):
        r = client.get(url, params=params)
        if r.status_code != 429:
            r.raise_for_status()
            return r.json()
        wait = int(r.headers.get("retry-after") or 0) or 5 * (attempt + 1)
        print(f"    Wikimedia просить зачекати {wait} с…")
        time.sleep(wait)
    r.raise_for_status()
    return r.json()

def ukwiki_titles(client: httpx.Client, qids: list[str]) -> dict[str, str]:
    """wikidata_id -> uk.wikipedia article title (only for items that have one)."""
    out: dict[str, str] = {}
    for i in range(0, len(qids), 50):
        data = wiki_get(client, "https://www.wikidata.org/w/api.php", {
            "action": "wbgetentities", "ids": "|".join(qids[i:i + 50]), "props": "sitelinks",
            "sitefilter": "ukwiki", "format": "json"})
        for qid, ent in data.get("entities", {}).items():
            link = ent.get("sitelinks", {}).get("ukwiki")
            if link:
                out[qid] = link["title"]
    return out


def ukwiki_text(client: httpx.Client, title: str) -> str:
    data = wiki_get(client, "https://uk.wikipedia.org/w/api.php", {
        "action": "query", "prop": "extracts", "explaintext": 1, "redirects": 1,
        "titles": title, "format": "json", "formatversion": 2})
    pages = data["query"]["pages"]
    text = pages[0].get("extract", "") if pages else ""
    # Drop reference/link sections at the end: they hold no facts, only noise.
    return re.split(r"\n=+ (Примітки|Джерела|Література|Посилання|Див\. також) =+", text)[0].strip()


def collect_sources(client: httpx.Client, artist: dict, works: list[dict], urls: list[str],
                    text_file: Path | None, text_url: str | None) -> list[dict]:
    sources = []
    qids = [artist["wikidata_id"]] + [w["wikidata_id"] for w in works if w.get("wikidata_id")]
    # Commons-only paintings have ids M<pageid>: Wikidata rejects the whole batch if one of them is in it.
    titles = ukwiki_titles(client, [q for q in qids if q and q.startswith("Q")])
    for qid, title in titles.items():
        text = ukwiki_text(client, title)
        url = "https://uk.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
        if len(text) > 200:
            sources.append({"url": url, "text": text, "label": f"uk.wikipedia: {title}",
                            "about_qid": None if qid == artist["wikidata_id"] else qid})
        time.sleep(1)
    for url in urls:
        r = client.get(url, follow_redirects=True)
        r.raise_for_status()
        sources.append({"url": url, "text": html_to_text(r.text), "label": url})
    if text_file:
        sources.append({"url": text_url, "text": text_file.read_text(encoding="utf-8"), "label": str(text_file)})
    return sources


# ---------- extraction ----------

def work_key(w: dict) -> str:
    """How a painting is named to the model: its Wikidata id, or the seed id for rows without one."""
    return w.get("wikidata_id") or str(w["id"])


def artist_works(artist: dict) -> list[dict]:
    """Paintings facts may be about: the catalogue's, plus new candidates from collect_paintings.py
    (data/artwork_drafts/<slug>.json) that are not rejected. Candidates have id None until published."""
    works = [w for w in load_json(SEED / "artworks.json", [])
             if w["artist_id"] == artist["id"] and not w["slug"].startswith("stub-")
             and w.get("review_status") != "rejected"]
    known = {w.get("wikidata_id") for w in works}
    draft = load_json(DATA_DIR / "artwork_drafts" / f"{artist['slug']}.json", {})
    for c in draft.get("candidates", []):
        if c["qid"] not in known and c.get("status") != "rejected" and c.get("title_uk"):
            works.append({"id": None, "wikidata_id": c["qid"], "title_uk": c["title_uk"], "year": c.get("year")})
    return works


def check(raw: dict, source: dict, artist_id: int, works: dict[str, dict]) -> tuple[dict | None, str | None]:
    """Return (draft, None) when the fact passes the automatic screening, else (None, reason).
    `works` maps work_key() -> painting."""
    text, quote = (raw.get("text_uk") or "").strip(), (raw.get("quote") or "").strip()
    if not text or not quote:
        return None, "немає тексту або цитати"
    if "..." in quote or "…" in quote:
        return None, "цитата скорочена"
    if len(quote) < MIN_QUOTE_CHARS:
        return None, "цитата закоротка"
    if normalise(quote) not in normalise(source["text"]):
        return None, "цитати немає в джерелі"
    missing = numbers(text) - numbers(quote)
    if missing:
        return None, f"числа {sorted(missing)} є у факті, але не в цитаті"
    about, work = raw.get("about"), None
    if about != "artist":
        key = str(about).strip()
        work = works.get(key) or next((w for w in works.values() if str(w["id"]) == key), None)
        if work is None:
            return None, f"artwork_id {about!r} не належить цьому художнику"
        own_article = source.get("about_qid") and source["about_qid"] == work.get("wikidata_id")
        if not own_article and (not work.get("title_uk") or not _title_in(work["title_uk"], quote)):
            return None, f"у цитаті немає назви картини «{work.get('title_uk')}»"
        about = work["id"] if work["id"] is not None else work["wikidata_id"]
    kind = raw.get("kind") if raw.get("kind") in KINDS else "other"
    return {
        "id": fact_id(quote, about),
        "status": "pending",
        "artist_id": artist_id if about == "artist" else None,
        "artwork_id": work["id"] if work else None,
        "artwork_qid": work.get("wikidata_id") if work else None,
        "artwork_title": work["title_uk"] if work else None,
        "text_uk": text,
        "quote": quote,
        "source_url": source["url"],
        "second_source_url": "",
        "kind": kind,
        "ai_interest": raw.get("interest"),
        "why": raw.get("why", ""),
        "interesting": None,
        "note": "",
    }, None


def _title_in(title: str, text: str) -> bool:
    """Every longer word of the title occurs in the text, ignoring Ukrainian case endings."""
    words = re.findall(r"[\w']+", normalise(title))
    stems = [w[: max(4, len(w) - 2)] for w in words if len(w) >= 4] or words
    plain = normalise(text)
    return bool(stems) and all(st in plain for st in stems)


GEMINI_TIMEOUT_S = 300  # a long answer of a thinking model takes minutes; past this the model is stuck, try another


# Models to switch to when the main one is overloaded, fastest-but-good first. Quotas of the free
# tier are per model, so a busy or rate-limited model does not slow the others down.
# Override in backend/.env: AI_FALLBACK_MODELS=gemini-3.7-flash,gemini-3.1-flash-lite  (empty = no fallback)
FALLBACK_MODELS = ["gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"]
MAX_WAIT_S = 30  # when every model rests, wait this long and try the one that rests the shortest


class ModelBusy(Exception):
    """The model cannot answer now; it rests `rest_s` seconds before it is tried again."""

    def __init__(self, message: str, rest_s: float):
        super().__init__(message)
        self.rest_s = rest_s


class ModelGone(Exception):
    """The model is not available for this key or request (HTTP 400/403/404)."""


def _fallbacks_from_env() -> list[str]:
    raw = os.environ.get("AI_FALLBACK_MODELS")
    if raw is None:
        env = DATA_DIR.parent / "backend" / ".env"
        for line in (env.read_text(encoding="utf-8").splitlines() if env.exists() else []):
            if line.strip().startswith("AI_FALLBACK_MODELS="):
                raw = line.split("=", 1)[1].split("#", 1)[0].strip().strip("'\"")
    if raw is None:
        return FALLBACK_MODELS
    return [m.strip() for m in raw.split(",") if m.strip()]


class ModelChain:
    """The main model plus fallbacks. A model that answers «overloaded» rests for a while and the
    next calls go straight to the next model, so a run never waits minutes on one busy model."""

    def __init__(self, main: str, fallbacks: list[str] | None = None):
        extra = _fallbacks_from_env() if fallbacks is None else fallbacks
        self.models = list(dict.fromkeys([main, *extra]))
        self.resting: dict[str, float] = {}
        self.used: dict[str, int] = {}

    def pick(self) -> tuple[str, float]:
        """(model, seconds to wait first)."""
        if not self.models:
            raise RuntimeError("Жодна модель Gemini не доступна. Перевір AI_MODEL / AI_FALLBACK_MODELS.")
        now = time.monotonic()
        for m in self.models:
            if self.resting.get(m, 0) <= now:
                return m, 0
        m = min(self.models, key=lambda m: self.resting[m])
        return m, min(MAX_WAIT_S, self.resting[m] - now)

    def busy(self, model: str, err: ModelBusy) -> None:
        self.resting[model] = time.monotonic() + err.rest_s
        nxt, wait = self.pick()
        then = f"беру {nxt}" if nxt != model and not wait else f"чекаю {wait:.0f} с"
        print(f"    {model}: {err} → {then}")

    def gone(self, model: str, err: Exception) -> None:
        self.models.remove(model)
        print(f"    {model}: {err} → більше не використовую")

    def ok(self, model: str) -> None:
        self.used[model] = self.used.get(model, 0) + 1

    def summary(self) -> str:
        """For the draft's «model» field: which models actually wrote it."""
        if len(self.used) == 1:
            return next(iter(self.used))
        return ", ".join(f"{m} ×{n}" for m, n in self.used.items()) or self.models[0]


MAX_ATTEMPTS = 12


async def call_gemini(prompt: str, *, system: str, settings: Settings, model: "str | ModelChain",
                      temperature: float, timeout: float = GEMINI_TIMEOUT_S):
    """generate_json that moves on to another model when one is overloaded or rate-limited."""
    chain = model if isinstance(model, ModelChain) else ModelChain(model, fallbacks=[])
    last = None
    for _ in range(MAX_ATTEMPTS):
        m, wait = chain.pick()
        if wait:
            await asyncio.sleep(wait)
        try:
            data = await generate_json(prompt, system=system, api_key=settings.ai_api_key, model=m,
                                       timeout=timeout, temperature=temperature)
        except RateLimited:
            last = ModelBusy("ліміт запитів (429)", 60)
        except httpx.TimeoutException:
            last = ModelBusy(f"не відповів за {timeout:.0f} с", 300)
        except httpx.HTTPStatusError as e:
            code = e.response.status_code
            if code >= 500:
                last = ModelBusy(f"перевантажений ({code})", 300)
            elif code in (400, 403, 404) and len(chain.models) > 1:
                chain.gone(m, RuntimeError(f"недоступна ({code})"))
                continue
            else:
                raise RuntimeError(f"Gemini повернув {code}: {e.response.text[:300]}") from None
        else:
            chain.ok(m)
            return data
        chain.busy(m, last)
    raise RuntimeError(f"Gemini так і не відповів: {last}. Спробуй пізніше.")


async def ask(source: dict, artist: dict, works: list[dict], settings: Settings, model: str, n: int,
              timeout: float = GEMINI_TIMEOUT_S) -> list[dict]:
    listing = "\n".join(f"{work_key(w)}: {w['title_uk']}, {w.get('year') or 'рік невідомий'}" for w in works)
    prompt = PROMPT.format(artist=artist["name_uk"], artworks=listing, source_url=source["url"],
                           text=source["text"][:MAX_SOURCE_CHARS], n=n, kinds=KINDS)
    data = await call_gemini(prompt, system=SYSTEM, settings=settings, model=model, temperature=0.3, timeout=timeout)
    return data.get("facts", []) if isinstance(data, dict) else []


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cmd_extract(args) -> int:
    settings = Settings()
    if not settings.ai_api_key and not args.dry_run:
        print("Потрібен AI_API_KEY у backend/.env (ключ Gemini з Google AI Studio).")
        return 1
    model = args.model or settings.ai_model
    chain = ModelChain(model)
    artists = load_json(SEED / "artists.json", [])
    artist = next((a for a in artists if a["slug"] == args.artist), None)
    if not artist:
        print(f"Художника {args.artist!r} немає в data/seed/artists.json. Є: {', '.join(a['slug'] for a in artists)}")
        return 1
    works = artist_works(artist)
    by_key = {work_key(w): w for w in works}

    with httpx.Client(timeout=30, headers={"User-Agent": USER_AGENT}) as client:
        sources = collect_sources(client, artist, works, args.url, args.text_file, args.text_url)
    print(f"{artist['name_uk']}: {len(works)} картин, {len(sources)} джерел")
    for s in sources:
        print(f"  - {s['label']} ({len(s['text'])} символів)")
    if args.dry_run or not sources:
        return 0

    path = DRAFTS_DIR / f"{artist['slug']}.json"
    drafts = load_json(path, {"artist_id": artist["id"], "artist": artist["name_uk"], "facts": [], "screened_out": []})
    known = {f["id"] for f in drafts["facts"]}
    added = dropped = 0
    for s in sources:
        print(f"→ {s['label']}")
        print("    чекаю відповідь Gemini…")
        raw_facts = asyncio.run(ask(s, artist, works, settings, chain, args.per_source, args.timeout))
        for raw in raw_facts:
            draft, reason = check(raw, s, artist["id"], by_key)
            if reason:
                dropped += 1
                entry = {"reason": reason, "source_url": s["url"],
                         "text_uk": raw.get("text_uk"), "quote": raw.get("quote")}
                if entry not in drafts["screened_out"]:  # a re-run must not inflate the report
                    drafts["screened_out"].append(entry)
                print(f"    ✗ {reason}: {(raw.get('text_uk') or '')[:70]}")
            elif draft["id"] in known:
                print(f"    = вже є: {draft['text_uk'][:70]}")
            else:
                known.add(draft["id"])
                drafts["facts"].append(draft)
                added += 1
                print(f"    ✓ {draft['text_uk'][:90]}")
        time.sleep(2)
    drafts["model"] = chain.summary()
    drafts["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    save_json(path, drafts)
    print(f"\nНових чернеток: {added}, відсіяно автоматично: {dropped}. Файл: {path}")
    print("Далі: перевір чернетки (status / second_source_url / interesting), потім `report` і `import`.")
    return 0


def cmd_report(args) -> int:
    for path in sorted(DRAFTS_DIR.glob("*.json")):
        d = load_json(path, {})
        facts, out = d.get("facts", []), d.get("screened_out", [])
        reviewed = [f for f in facts if f["status"] != "pending"]
        approved = [f for f in facts if f["status"] == "approved"]
        two_sources = [f for f in approved if f.get("second_source_url")]
        interesting = [f for f in reviewed if f.get("interesting") is True]
        rated = [f for f in reviewed if f.get("interesting") is not None]
        print(f"\n{d.get('artist', path.stem)}  ({path})")
        print(f"  згенеровано всього:          {len(facts) + len(out)}")
        print(f"  відсіяно скриптом:           {len(out)}")
        for reason in sorted({o['reason'] for o in out}):
            print(f"      {sum(o['reason'] == reason for o in out)} × {reason}")
        print(f"  чернеток для людини:         {len(facts)}  (перевірено {len(reviewed)}, чекає {len(facts) - len(reviewed)})")
        if reviewed:
            print(f"  правдиві (approved):         {len(approved)}/{len(reviewed)}  ціль ≥ 80%")
            print(f"  з другим джерелом:           {len(two_sources)}/{len(approved)}")
        if rated:
            print(f"  цікаві:                      {len(interesting)}/{len(rated)}  ціль ≥ 50%")
    return 0


def cmd_import(args) -> int:
    facts = load_json(SEED / "facts.json", [])
    by_scope_placeholder = {}
    for f in facts:
        if f["text_uk"].startswith(PLACEHOLDER):
            by_scope_placeholder.setdefault((f.get("artist_id"), f.get("artwork_id")), []).append(f)
    existing = {(f.get("artist_id"), f.get("artwork_id"), normalise(f["text_uk"])) for f in facts}
    seed_by_qid = {w["wikidata_id"]: w["id"] for w in load_json(SEED / "artworks.json", []) if w.get("wikidata_id")}
    waiting = 0
    next_id = max((f["id"] for f in facts), default=0) + 1
    added = replaced = skipped = 0
    for path in sorted(DRAFTS_DIR.glob("*.json")):
        for d in load_json(path, {}).get("facts", []):
            if d["status"] != "approved":
                continue
            if not d.get("second_source_url"):
                skipped += 1
                print(f"  пропущено (немає second_source_url): {d['text_uk'][:70]}")
                continue
            if d.get("artwork_id") is None and d.get("artwork_qid"):
                # a fact about a new painting: it gets a seed id once the painting is published
                d = {**d, "artwork_id": seed_by_qid.get(d["artwork_qid"])}
                if d["artwork_id"] is None:
                    waiting += 1
                    print(f"  чекає на картину {d['artwork_qid']} (ще не в каталозі): {d['text_uk'][:60]}")
                    continue
            scope = (d["artist_id"], d["artwork_id"])
            key = (*scope, normalise(d["text_uk"]))
            if key in existing:
                continue
            row = {"artist_id": d["artist_id"], "artwork_id": d["artwork_id"], "text_uk": d["text_uk"],
                   "source_url": d["source_url"], "verified": True}
            placeholders = by_scope_placeholder.get(scope)
            if placeholders:
                target = placeholders.pop(0)
                target.update(row)
                replaced += 1
                print(f"  замінено заглушку #{target['id']}: {d['text_uk'][:70]}")
            else:
                facts.append({"id": next_id, **row})
                next_id += 1
                added += 1
                print(f"  + #{next_id - 1}: {d['text_uk'][:70]}")
            existing.add(key)
    print(f"\nДодано {added}, замінено заглушок {replaced}, пропущено без другого джерела {skipped}"
          + (f", чекають на картину {waiting}" if waiting else "") + ".")
    if args.dry_run:
        print("--dry-run: data/seed/facts.json не змінено.")
    elif added or replaced:
        save_json(SEED / "facts.json", facts)
        print("Записано data/seed/facts.json. Далі: upload_to_supabase.py і перезапуск бекенду.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0],
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract", help="зібрати джерела і згенерувати чернетки фактів")
    e.add_argument("--artist", required=True, help="slug з data/seed/artists.json, напр. mykola-pymonenko")
    e.add_argument("--url", action="append", default=[], help="додаткове джерело (можна кілька разів)")
    e.add_argument("--text-file", type=Path, help="текст джерела, збережений вручну")
    e.add_argument("--text-url", help="адреса, звідки взято --text-file")
    e.add_argument("--per-source", type=int, default=5, help="скільки фактів просити з одного джерела")
    e.add_argument("--model", help="модель Gemini (за замовчуванням AI_MODEL)")
    e.add_argument("--timeout", type=float, default=GEMINI_TIMEOUT_S, help="скільки секунд чекати на Gemini")
    e.add_argument("--dry-run", action="store_true", help="лише показати знайдені джерела")
    sub.add_parser("report", help="цифри для валідації")
    i = sub.add_parser("import", help="approved-факти -> data/seed/facts.json")
    i.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.cmd == "extract" and bool(args.text_file) != bool(args.text_url):
        parser.error("--text-file і --text-url потрібні разом")
    return {"extract": cmd_extract, "report": cmd_report, "import": cmd_import}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
