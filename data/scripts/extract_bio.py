"""Artist biography drafts: Wikidata facts + Gemini retelling with a quote per sentence -> review -> artists.json.

Fills the artist fields that are still «ЗАГЛУШКА» placeholders:
  - birth_place   from Wikidata (place of birth, P19), no AI;
  - portrait_url  from Wikidata (image, P18) via Wikimedia Commons, with its licence for review.
                  On import the picture is copied to data/images/portraits/<slug>.jpg (400 px), and
                  upload_to_supabase.py puts it into its own Storage bucket «portraits»;
  - short_bio     2–3 sentences (page «Художники»);
  - long_bio      300–500 words (artist page).

The biographies are written by Gemini from real sources (the artist's uk.wikipedia article plus any
--url / --text-file you add). Gemini must retell, not copy, and back every sentence with an exact
quote. The script checks each quote against the downloaded source and the numbers in each sentence
against its quote, like extract_facts.py does for facts. Sentences that fail are left out of the
draft text and listed under «screened_out»; sentences copied word for word are kept but flagged.

1. Draft (one artist):

    backend/.venv/bin/python data/scripts/extract_bio.py extract --artist mykola-pymonenko
    backend/.venv/bin/python data/scripts/extract_bio.py extract --artist mykola-pymonenko \\
        --text-file ~/esu_pymonenko.txt --text-url https://esu.com.ua/article-XXXX

   Writes data/bio_drafts/<artist-slug>.json. A draft you already approved or rejected is not
   overwritten (use --force to regenerate it).

2. Review data/bio_drafts/<artist-slug>.json:
     "short_bio", "long_bio", "birth_place"  edit the text freely; keep only what the sources say
     "portrait": {"use": true|false}        check the picture and its licence on "file_page"
     "status": "approved" | "rejected"
   «sentences» shows which quote backs which sentence; «warnings» lists copied sentences.

3. Status of all drafts, then copy approved ones into data/seed/artists.json:

    backend/.venv/bin/python data/scripts/extract_bio.py report
    backend/.venv/bin/python data/scripts/extract_bio.py import [--dry-run]

   Then upload_to_supabase.py (and restart the backend). No embeddings are involved.

Needs AI_API_KEY (and AI_MODEL) in backend/.env for `extract`.
"""

import argparse
import asyncio
import io
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402

from extract_facts import (  # noqa: E402  (shared source/quote helpers)
    DATA_DIR,
    GEMINI_TIMEOUT_S,
    PLACEHOLDER,
    SEED,
    USER_AGENT,
    Settings,
    call_gemini,
    html_to_text,
    load_json,
    normalise,
    numbers,
    save_json,
    ukwiki_text,
    ukwiki_titles,
    wiki_get,
)

DRAFTS_DIR = DATA_DIR / "bio_drafts"
PORTRAITS_DIR = DATA_DIR / "images" / "portraits"  # served locally under /static/images/portraits/
PORTRAIT_PX = 400  # long side; the oval portrait is at most ~150 px tall, so this is sharp on retina
MAX_SOURCE_CHARS = 60_000
MIN_QUOTE_CHARS = 15
COPIED_CHARS = 60  # a sentence this long found verbatim in a source counts as copied
FREE_LICENCES = ("public domain", "pd", "cc0", "cc by")

SYSTEM = """Ти пишеш біографії українських художників для застосунку мемів з їхніх картин.
Жорсткі правила:
- Використовуй ТІЛЬКИ надані тексти джерел. Нічого не додавай від себе, навіть якщо знаєш.
- Переказуй своїми словами. Не копіюй речення з джерела (це вимога ліцензії).
- До КОЖНОГО речення дай `quote` — дослівний неперервний фрагмент джерела (скопійований символ
  у символ, без «...»), який це речення підтверджує, і `source` — мітку джерела, напр. "S1".
- Усі числа й роки в реченні мають бути в його цитаті.
- Без оцінок на кшталт «видатний», «геніальний», «великий»: лише що робив, де, коли, що з ним сталося.
- Жива проста українська, як для допитливого підлітка.
Відповідай JSON-об'єктом."""

PROMPT = """Художник: {artist} ({years})

Джерела:
{sources}

Напиши:
1. short_bio — 2–3 речення: хто він, чим відомий, одна жива деталь.
2. long_bio — 300–500 слів, 3–5 абзаців: походження й навчання, як склався шлях, головні теми
   й картини, визнання, несподівані епізоди, кінець життя.
Формат:
{{"short_bio": [{{"sentence": "...", "quote": "...", "source": "S1"}}],
  "long_bio": [{{"paragraph": 1, "sentence": "...", "quote": "...", "source": "S1"}}]}}"""


# ---------- Wikidata: birth place and portrait ----------

def wikidata_claims(client: httpx.Client, qid: str) -> dict:
    data = wiki_get(client, "https://www.wikidata.org/w/api.php",
                    {"action": "wbgetentities", "ids": qid, "props": "claims", "format": "json"})
    return data["entities"][qid].get("claims", {})


def first_value(claims: dict, prop: str):
    for c in claims.get(prop, []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if v:
            return v
    return None


def uk_label(client: httpx.Client, qid: str) -> str | None:
    data = wiki_get(client, "https://www.wikidata.org/w/api.php", {
        "action": "wbgetentities", "ids": qid, "props": "labels", "languages": "uk|en", "format": "json"})
    labels = data["entities"][qid].get("labels", {})
    return (labels.get("uk") or labels.get("en") or {}).get("value")


def commons_image(client: httpx.Client, filename: str) -> dict:
    """Commons file -> 400 px thumbnail URL, file page and licence."""
    data = wiki_get(client, "https://commons.wikimedia.org/w/api.php", {
        "action": "query", "titles": f"File:{filename}", "prop": "imageinfo", "iiprop": "url|extmetadata",
        "iiurlwidth": 400, "format": "json", "formatversion": 2})
    info = (data["query"]["pages"][0].get("imageinfo") or [{}])[0]
    meta = info.get("extmetadata", {})
    licence = re.sub(r"<[^>]+>", "", (meta.get("LicenseShortName") or {}).get("value", "")).strip()
    return {
        "url": info.get("thumburl") or info.get("url"),
        "file_page": info.get("descriptionurl"),
        "license": licence or "невідомо",
        "license_ok": licence.casefold().startswith(FREE_LICENCES),
    }


def structured(client: httpx.Client, artist: dict) -> dict:
    qid = artist["wikidata_id"]
    claims = wikidata_claims(client, qid)
    out = {"birth_place": None, "portrait": None}
    place = first_value(claims, "P19")
    if place:
        out["birth_place"] = {"value": uk_label(client, place["id"]),
                              "source_url": f"https://www.wikidata.org/wiki/{qid}#P19"}
    image = first_value(claims, "P18")
    if image:
        out["portrait"] = {**commons_image(client, image), "use": None}
    return out


# ---------- sources and screening ----------

def collect(client: httpx.Client, artist: dict, urls: list[str], text_file: Path | None, text_url: str | None) -> list[dict]:
    sources = []
    title = ukwiki_titles(client, [artist["wikidata_id"]]).get(artist["wikidata_id"])
    if title:
        sources.append({"url": "https://uk.wikipedia.org/wiki/" + title.replace(" ", "_"),
                        "text": ukwiki_text(client, title), "label": f"uk.wikipedia: {title}"})
    for url in urls:
        r = client.get(url, follow_redirects=True)
        r.raise_for_status()
        sources.append({"url": url, "text": html_to_text(r.text), "label": url})
    if text_file:
        sources.append({"url": text_url, "text": text_file.read_text(encoding="utf-8"), "label": str(text_file)})
    for i, s in enumerate(sources, 1):
        s["id"] = f"S{i}"
    return sources


def check_sentence(item: dict, by_id: dict) -> tuple[str | None, str | None]:
    """(reason it fails, warning). A failing sentence is left out of the draft text."""
    sentence, quote = (item.get("sentence") or "").strip(), (item.get("quote") or "").strip()
    src = by_id.get(item.get("source"))
    if not sentence or not quote:
        return "немає речення або цитати", None
    if src is None:
        return f"невідоме джерело {item.get('source')!r}", None
    if "..." in quote or "…" in quote:
        return "цитата скорочена", None
    if len(quote) < MIN_QUOTE_CHARS:
        return "цитата закоротка", None
    if normalise(quote) not in normalise(src["text"]):
        return "цитати немає в джерелі", None
    missing = numbers(sentence) - numbers(quote)
    if missing:
        return f"числа {sorted(missing)} є в реченні, але не в цитаті", None
    copied = len(sentence) >= COPIED_CHARS and normalise(sentence.rstrip(".")) in normalise(src["text"])
    return None, ("речення скопійоване дослівно — перекажи" if copied else None)


def assemble(items: list[dict], by_paragraph: bool) -> str:
    if not by_paragraph:
        return " ".join(i["sentence"] for i in items)
    paragraphs: dict[int, list[str]] = {}
    for i in items:
        paragraphs.setdefault(int(i.get("paragraph") or 1), []).append(i["sentence"])
    return "\n\n".join(" ".join(p) for _, p in sorted(paragraphs.items()))


async def ask(artist: dict, sources: list[dict], settings: Settings, model: str,
              timeout: float = GEMINI_TIMEOUT_S) -> dict:
    years = f"{artist.get('birth_year') or '?'}–{artist.get('death_year') or '?'}"
    budget = MAX_SOURCE_CHARS // max(1, len(sources))
    block = "\n\n".join(f"[{s['id']}] {s['url']}\n<<<\n{s['text'][:budget]}\n>>>" for s in sources)
    prompt = PROMPT.format(artist=artist["name_uk"], years=years, sources=block)
    data = await call_gemini(prompt, system=SYSTEM, settings=settings, model=model, temperature=0.4, timeout=timeout)
    return data if isinstance(data, dict) else {}


# ---------- commands ----------

def save_portrait(url: str, slug: str) -> str:
    """Download the Commons portrait into data/images/portraits; return its seed path."""
    from PIL import Image, ImageOps  # backend venv; only needed on import

    r = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=60, follow_redirects=True)
    r.raise_for_status()
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(r.content))).convert("RGB")
    img.thumbnail((PORTRAIT_PX, PORTRAIT_PX), Image.LANCZOS)
    PORTRAITS_DIR.mkdir(parents=True, exist_ok=True)
    path = PORTRAITS_DIR / f"{slug}.jpg"
    img.save(path, "JPEG", quality=85, optimize=True, progressive=True)
    return f"images/portraits/{path.name}"

def cmd_extract(args) -> int:
    settings = Settings()
    if not settings.ai_api_key and not args.dry_run:
        print("Потрібен AI_API_KEY у backend/.env (ключ Gemini з Google AI Studio).")
        return 1
    model = args.model or settings.ai_model
    if not model and not args.dry_run:
        print("Порожній AI_MODEL у backend/.env — впиши, напр., gemini-3.1-flash-lite або дай --model.")
        return 1
    artists = load_json(SEED / "artists.json", [])
    artist = next((a for a in artists if a["slug"] == args.artist), None)
    if not artist:
        print(f"Художника {args.artist!r} немає в data/seed/artists.json. Є: {', '.join(a['slug'] for a in artists)}")
        return 1
    path = DRAFTS_DIR / f"{artist['slug']}.json"
    old = load_json(path, None)
    if old and old.get("status") != "pending" and not args.force:
        print(f"{path} уже перевірено (status={old['status']}). Щоб згенерувати заново, додай --force.")
        return 1

    with httpx.Client(timeout=30, headers={"User-Agent": USER_AGENT}) as client:
        facts = structured(client, artist)
        time.sleep(1)
        sources = collect(client, artist, args.url, args.text_file, args.text_url)
    print(f"{artist['name_uk']}")
    print(f"  місце народження (Wikidata): {(facts['birth_place'] or {}).get('value') or '—'}")
    p = facts["portrait"]
    print(f"  портрет: {p['file_page'] + ' · ' + p['license'] if p else '—'}")
    for s in sources:
        print(f"  {s['id']}: {s['label']} ({len(s['text'])} символів)")
    if args.dry_run or not sources:
        if not sources:
            print("Немає жодного джерела тексту: додай --url або --text-file.")
        return 0

    print("Gemini пише біографію, це може тривати кілька хвилин…")
    raw = asyncio.run(ask(artist, sources, settings, model, args.timeout))
    by_id = {s["id"]: s for s in sources}
    kept: dict[str, list[dict]] = {"short_bio": [], "long_bio": []}
    sentences, screened, warnings = [], [], []
    for field in kept:
        for item in raw.get(field) or []:
            reason, warning = check_sentence(item, by_id)
            src = by_id.get(item.get("source")) or {}
            row = {"field": field, "paragraph": item.get("paragraph"), "sentence": item.get("sentence"),
                   "quote": item.get("quote"), "source_url": src.get("url")}
            if reason:
                screened.append({**row, "reason": reason})
                print(f"  ✗ {reason}: {(item.get('sentence') or '')[:70]}")
                continue
            kept[field].append(item)
            sentences.append(row)
            if warning:
                warnings.append({**row, "warning": warning})
                print(f"  ! {warning}: {item['sentence'][:70]}")

    long_bio = assemble(kept["long_bio"], by_paragraph=True)
    draft = {
        "artist_id": artist["id"],
        "artist": artist["name_uk"],
        "status": "pending",
        "birth_place": (facts["birth_place"] or {}).get("value"),
        "birth_place_source": (facts["birth_place"] or {}).get("source_url"),
        "portrait": facts["portrait"],
        "short_bio": assemble(kept["short_bio"], by_paragraph=False),
        "long_bio": long_bio,
        "long_bio_words": len(long_bio.split()),
        "sources": [s["url"] for s in sources if s.get("url")],
        "note": "",
        "warnings": warnings,
        "sentences": sentences,
        "screened_out": screened,
        "model": model,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    save_json(path, draft)
    total = len(sentences) + len(screened)
    print(f"\nРечень: {total}, прийнято {len(sentences)}, відсіяно {len(screened)}, скопійованих {len(warnings)}. "
          f"long_bio: {draft['long_bio_words']} слів (ціль 300–500).")
    print(f"Чернетка: {path}\nДалі: перевір, постав status «approved», потім `import`.")
    return 0


def cmd_report(args) -> int:
    for path in sorted(DRAFTS_DIR.glob("*.json")):
        d = load_json(path, {})
        p = d.get("portrait") or {}
        total = len(d.get("sentences", [])) + len(d.get("screened_out", []))
        print(f"\n{d.get('artist', path.stem)}: {d.get('status')}")
        print(f"  речень прийнято {len(d.get('sentences', []))}/{total}, скопійованих {len(d.get('warnings', []))}")
        print(f"  long_bio {len(d.get('long_bio', '').split())} слів; місце народження: {d.get('birth_place') or '—'}")
        print(f"  портрет: {p.get('license', '—')}, use={p.get('use')}")
    return 0


def cmd_import(args) -> int:
    artists = load_json(SEED / "artists.json", [])
    by_id = {a["id"]: a for a in artists}
    changed = 0
    for path in sorted(DRAFTS_DIR.glob("*.json")):
        d = load_json(path, {})
        if d.get("status") != "approved":
            continue
        a = by_id.get(d["artist_id"])
        if a is None:
            print(f"  {path.name}: художника #{d['artist_id']} немає в artists.json")
            continue
        update = {k: d[k].strip() for k in ("birth_place", "short_bio", "long_bio") if (d.get(k) or "").strip()}
        p = d.get("portrait") or {}
        if p.get("url") and (p.get("use") is True or (p.get("use") is None and p.get("license_ok"))):
            local = f"images/portraits/{a['slug']}.jpg"
            if a.get("portrait_url") == local and (DATA_DIR / local).exists() and not args.refresh_portraits:
                update["portrait_url"] = local  # already copied
            elif args.dry_run:
                update["portrait_url"] = local
                print(f"  {d['artist']}: портрет буде завантажено в data/{local}")
            else:
                try:
                    update["portrait_url"] = save_portrait(p["url"], a["slug"])
                    print(f"  {d['artist']}: портрет збережено в data/{update['portrait_url']}")
                except Exception as exc:  # network/image error: keep the rest of the biography
                    print(f"  {d['artist']}: портрет не завантажився ({exc}); спробуй import ще раз")
        elif p.get("url"):
            print(f"  {d['artist']}: портрет не взято (ліцензія «{p.get('license')}», use={p.get('use')})")
        update["sources"] = list(dict.fromkeys((a.get("sources") or []) + d.get("sources", [])))
        leftovers = [k for k in ("short_bio", "long_bio", "birth_place") if PLACEHOLDER in str(update.get(k, ""))]
        if leftovers:
            print(f"  {d['artist']}: у чернетці лишились заглушки в {leftovers}, пропущено")
            continue
        diff = [k for k, v in update.items() if a.get(k) != v]
        if diff:
            a.update(update)
            changed += 1
            print(f"  {d['artist']}: оновлено {', '.join(diff)}")
    print(f"\nОновлено художників: {changed}.")
    if args.dry_run:
        print("--dry-run: data/seed/artists.json не змінено.")
    elif changed:
        save_json(SEED / "artists.json", artists)
        print("Записано data/seed/artists.json. Далі: upload_to_supabase.py і перезапуск бекенду.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0],
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract", help="зібрати дані й згенерувати чернетку біографії")
    e.add_argument("--artist", required=True, help="slug з data/seed/artists.json, напр. mykola-pymonenko")
    e.add_argument("--url", action="append", default=[], help="додаткове джерело (можна кілька разів)")
    e.add_argument("--text-file", type=Path, help="текст джерела, збережений вручну")
    e.add_argument("--text-url", help="адреса, звідки взято --text-file")
    e.add_argument("--model", help="модель Gemini (за замовчуванням AI_MODEL)")
    e.add_argument("--force", action="store_true", help="перезаписати вже перевірену чернетку")
    e.add_argument("--timeout", type=float, default=GEMINI_TIMEOUT_S, help="скільки секунд чекати на Gemini")
    e.add_argument("--dry-run", action="store_true", help="лише показати дані Wikidata і джерела")
    sub.add_parser("report", help="стан чернеток")
    i = sub.add_parser("import", help="approved-чернетки -> data/seed/artists.json (+ портрети в data/images/portraits)")
    i.add_argument("--dry-run", action="store_true")
    i.add_argument("--refresh-portraits", action="store_true", help="завантажити портрети заново")
    args = parser.parse_args()
    if args.cmd == "extract" and bool(args.text_file) != bool(args.text_url):
        parser.error("--text-file і --text-url потрібні разом")
    return {"extract": cmd_extract, "report": cmd_report, "import": cmd_import}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
