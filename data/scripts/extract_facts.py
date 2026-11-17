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
Картини цього художника в нашому каталозі (artwork_id: назва, рік):
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
  "about": "artist" або artwork_id (число) з переліку вище, якщо факт саме про цю картину,
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
    titles = ukwiki_titles(client, [q for q in qids if q])
    for qid, title in titles.items():
        text = ukwiki_text(client, title)
        url = "https://uk.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
        if len(text) > 200:
            sources.append({"url": url, "text": text, "label": f"uk.wikipedia: {title}"})
        time.sleep(1)
    for url in urls:
        r = client.get(url, follow_redirects=True)
        r.raise_for_status()
        sources.append({"url": url, "text": html_to_text(r.text), "label": url})
    if text_file:
        sources.append({"url": text_url, "text": text_file.read_text(encoding="utf-8"), "label": str(text_file)})
    return sources


# ---------- extraction ----------

def check(raw: dict, source: dict, artist_id: int, work_ids: set[int]) -> tuple[dict | None, str | None]:
    """Return (draft, None) when the fact passes the automatic screening, else (None, reason)."""
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
    about = raw.get("about")
    if about != "artist":
        try:
            about = int(about)
        except (TypeError, ValueError):
            return None, f"невідомо, про що факт: {about!r}"
        if about not in work_ids:
            return None, f"artwork_id {about} не належить цьому художнику"
    kind = raw.get("kind") if raw.get("kind") in KINDS else "other"
    return {
        "id": fact_id(quote, about),
        "status": "pending",
        "artist_id": artist_id if about == "artist" else None,
        "artwork_id": None if about == "artist" else about,
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


async def ask(source: dict, artist: dict, works: list[dict], settings: Settings, model: str, n: int) -> list[dict]:
    listing = "\n".join(f"{w['id']}: {w['title_uk']}, {w.get('year') or 'рік невідомий'}" for w in works)
    prompt = PROMPT.format(artist=artist["name_uk"], artworks=listing, source_url=source["url"],
                           text=source["text"][:MAX_SOURCE_CHARS], n=n, kinds=KINDS)
    for attempt in range(6):
        try:
            data = await generate_json(prompt, system=SYSTEM, api_key=settings.ai_api_key, model=model,
                                       timeout=120, temperature=0.3)
            return data.get("facts", []) if isinstance(data, dict) else []
        except RateLimited:
            wait = 20 * (attempt + 1)
            print(f"    ліміт Gemini, чекаю {wait} с…")
            await asyncio.sleep(wait)
    raise RuntimeError("Gemini rate limit did not clear")


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
    artists = load_json(SEED / "artists.json", [])
    artist = next((a for a in artists if a["slug"] == args.artist), None)
    if not artist:
        print(f"Художника {args.artist!r} немає в data/seed/artists.json. Є: {', '.join(a['slug'] for a in artists)}")
        return 1
    works = [w for w in load_json(SEED / "artworks.json", [])
             if w["artist_id"] == artist["id"] and not w["slug"].startswith("stub-")
             and w.get("review_status") != "rejected"]
    work_ids = {w["id"] for w in works}

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
        raw_facts = asyncio.run(ask(s, artist, works, settings, model, args.per_source))
        for raw in raw_facts:
            draft, reason = check(raw, s, artist["id"], work_ids)
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
    drafts["model"] = model
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
    print(f"\nДодано {added}, замінено заглушок {replaced}, пропущено без другого джерела {skipped}.")
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
