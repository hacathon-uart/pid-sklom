"""One command for an artist: paintings + meme profiles + facts + biography, then the review page.

    backend/.venv/bin/python data/scripts/enrich_artist.py mykola-pymonenko
    backend/.venv/bin/python data/scripts/enrich_artist.py Q2601651          # or by Wikidata id (adds a new artist)

Stages (each one is its own script and can also be run alone):
  1. artist     — finds the artist in data/seed/artists.json, or adds a new one from Wikidata
                  (only if the artist died in 1955 or earlier: public domain in Ukraine);
  2. paintings  — collect_paintings.py: Wikidata + Commons, free licence, big enough image;
  3. profiles   — profile_artworks.py: Gemini looks at each new painting, writes a meme profile;
  4. facts      — extract_facts.py extract: unusual facts with verbatim quotes, screened automatically;
  5. bio        — extract_bio.py extract: short and long biography, every sentence with a quote;
  6. review     — review_server.py: a page on http://127.0.0.1:8765 to approve, edit and publish.

Re-runnable: finished stages are skipped (facts and bio already drafted, profiles already made).
Use --redo facts,bio to run them again, --only / --skip to pick stages, --no-review to stop before
the page. Stages 3–5 call Gemini and need AI_API_KEY in backend/.env.
"""

import argparse
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402

from collect_paintings import draft_path as paintings_draft  # noqa: E402
from extract_facts import DATA_DIR, PLACEHOLDER, SEED, USER_AGENT, Settings, load_json, save_json, wiki_get  # noqa: E402

SCRIPTS = Path(__file__).resolve().parent
STAGES = ("paintings", "profiles", "facts", "bio", "review")
GEMINI_STAGES = {"profiles", "facts", "bio"}
PD_DEATH_YEAR = 1955  # Ukraine: life + 70 years

# Ukrainian national transliteration (KMU 2010), enough for slugs.
TRANSLIT = {"а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d", "е": "e", "є": "ie", "ж": "zh", "з": "z",
            "и": "y", "і": "i", "ї": "i", "й": "i", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p",
            "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh",
            "щ": "shch", "ь": "", "ю": "iu", "я": "ia", "'": "", "’": "", "ʼ": ""}
WORD_START = {"є": "ye", "ї": "yi", "й": "y", "ю": "yu", "я": "ya"}


def slugify(name_uk: str) -> str:
    words = []
    for word in name_uk.casefold().split():
        out = "".join(WORD_START.get(ch, TRANSLIT.get(ch, ch)) if i == 0 else TRANSLIT.get(ch, ch)
                      for i, ch in enumerate(word))
        words.append(re.sub(r"[^a-z0-9]+", "-", out).strip("-"))
    return "-".join(w for w in words if w)


def _year(claims: dict, prop: str) -> int | None:
    for c in claims.get(prop, []):
        t = ((c.get("mainsnak") or {}).get("datavalue") or {}).get("value", {}).get("time", "")
        m = re.match(r"([+-]\d+)-", t)
        if m:
            return int(m.group(1))
    return None


def artist_from_wikidata(qid: str) -> dict:
    with httpx.Client(timeout=30, headers={"User-Agent": USER_AGENT}) as client:
        data = wiki_get(client, "https://www.wikidata.org/w/api.php", {
            "action": "wbgetentities", "ids": qid, "props": "labels|claims", "languages": "uk|en", "format": "json"})
    entity = data.get("entities", {}).get(qid)
    if not entity or "missing" in entity:
        raise SystemExit(f"На Wikidata немає {qid}")
    labels = entity.get("labels", {})
    name_uk = (labels.get("uk") or {}).get("value")
    if not name_uk:
        raise SystemExit(f"{qid}: на Wikidata немає українського імені. Додай художника в artists.json вручну.")
    words = name_uk.replace(",", " ").split()
    if len(words) == 3 and words[2].endswith(("ович", "евич", "івна", "ївна", "овна")):
        name_uk = f"{words[1]} {words[0]}"  # «Пимоненко Микола Корнилович» -> «Микола Пимоненко», as in the catalogue
    claims = entity.get("claims", {})
    return {"name_uk": name_uk, "birth_year": _year(claims, "P569"), "death_year": _year(claims, "P570")}


def ensure_artist(ref: str) -> dict:
    """slug or Wikidata id -> artist row; adds a new artist to data/seed/artists.json when needed."""
    artists = load_json(SEED / "artists.json", [])
    found = next((a for a in artists if ref in (a["slug"], a.get("wikidata_id"))), None)
    if found:
        return found
    if not re.fullmatch(r"Q\d+", ref):
        raise SystemExit(f"Художника {ref!r} немає в data/seed/artists.json. Дай його Wikidata id (Q…), "
                         f"або один зі slug: {', '.join(a['slug'] for a in artists)}")
    info = artist_from_wikidata(ref)
    if not info["death_year"]:
        raise SystemExit(f"{info['name_uk']}: на Wikidata немає року смерті — не можу перевірити суспільне надбання.")
    if info["death_year"] > PD_DEATH_YEAR:
        raise SystemExit(f"{info['name_uk']} помер у {info['death_year']}: його картини ще під авторським правом "
                         f"(в Україні — якщо автор помер у {PD_DEATH_YEAR} або раніше).")
    same = next((a for a in artists if a["name_uk"].casefold() == info["name_uk"].casefold()), None)
    if same:
        print(f"{info['name_uk']} уже є в artists.json як {same['slug']} (wikidata_id {same.get('wikidata_id')}).")
        return same
    slug = slugify(info["name_uk"])
    if any(a["slug"] == slug for a in artists):
        slug = f"{slug}-{ref.lower()}"
    artist = {
        "id": max((a["id"] for a in artists), default=0) + 1,
        "wikidata_id": ref,
        "slug": slug,
        "name_uk": info["name_uk"],
        "birth_year": info["birth_year"],
        "death_year": info["death_year"],
        "birth_place": f"{PLACEHOLDER}: місце народження",
        "short_bio": f"{PLACEHOLDER}: коротка біографія, 2–3 речення",
        "long_bio": f"{PLACEHOLDER}: розширена біографія, 300–500 слів",
        "portrait_url": None,
        "sources": [],
    }
    artists.append(artist)
    save_json(SEED / "artists.json", artists)
    print(f"Додано нового художника #{artist['id']} {artist['name_uk']} ({artist['birth_year']}–"
          f"{artist['death_year']}), slug {slug}")
    return artist


def run(script: str, *args: str) -> bool:
    cmd = [sys.executable, str(SCRIPTS / script), *args]
    print(f"\n$ {Path(sys.executable).name} data/scripts/{script} {' '.join(args)}", flush=True)
    started = time.monotonic()
    ok = subprocess.run(cmd).returncode == 0
    print(f"  {'готово' if ok else 'ПОМИЛКА'} за {time.monotonic() - started:.0f} с", flush=True)
    return ok


def stage_done(stage: str, slug: str, limit: int) -> str | None:
    """Why a stage can be skipped, or None when it has work to do."""
    if stage == "facts" and (DATA_DIR / "facts_drafts" / f"{slug}.json").exists():
        return "чернетка фактів уже є"
    if stage == "bio" and (DATA_DIR / "bio_drafts" / f"{slug}.json").exists():
        return "чернетка біографії вже є"
    if stage == "profiles":
        draft = load_json(paintings_draft(slug), {})
        new = [c for c in draft.get("candidates", []) if not c["in_catalogue"] and c.get("status") != "rejected"]
        with_profile = [c for c in new if c.get("profile")]
        if draft and (len(with_profile) >= limit or len(with_profile) == len(new)):
            return f"профілі вже є ({len(with_profile)} з {len(new)} нових картин)"
    return None


def parse_stages(value: str | None) -> set[str]:
    if not value:
        return set()
    out = {s.strip() for s in value.split(",") if s.strip()}
    bad = out - set(STAGES)
    if bad:
        raise SystemExit(f"Невідомі етапи: {', '.join(sorted(bad))}. Є: {', '.join(STAGES)}")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0],
                                     formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    parser.add_argument("artist", help="slug з data/seed/artists.json або Wikidata id (Q…)")
    parser.add_argument("--limit", type=int, default=12, help="скільки нових картин профілювати (12)")
    parser.add_argument("--model", help="модель Gemini для всіх етапів (за замовчуванням AI_MODEL)")
    parser.add_argument("--only", help=f"лише ці етапи, через кому: {','.join(STAGES)}")
    parser.add_argument("--skip", help="пропустити ці етапи, через кому")
    parser.add_argument("--redo", help="запустити ці етапи заново, навіть якщо вже зроблені (profiles,facts,bio)")
    parser.add_argument("--url", action="append", default=[], help="додаткове джерело для фактів і біографії")
    parser.add_argument("--no-review", action="store_true", help="не відкривати сторінку перевірки")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    only, skip, redo = parse_stages(args.only), parse_stages(args.skip), parse_stages(args.redo)
    stages = [s for s in STAGES if (not only or s in only) and s not in skip]
    if args.no_review and "review" in stages:
        stages.remove("review")

    artist = ensure_artist(args.artist)
    slug = artist["slug"]
    print(f"\n=== {artist['name_uk']} ({slug}) — етапи: {', '.join(stages)} ===")
    if not artist.get("wikidata_id") and "paintings" in stages:
        print("У художника немає wikidata_id — картини не знайти, етап paintings пропущено.")
        stages.remove("paintings")
    if GEMINI_STAGES & set(stages) and not Settings().ai_api_key:
        print("Немає AI_API_KEY у backend/.env — етапи з Gemini (profiles, facts, bio) пропущено.")
        stages = [s for s in stages if s not in GEMINI_STAGES]

    model = ["--model", args.model] if args.model else []
    urls = [x for u in args.url for x in ("--url", u)]
    failed = []
    for stage in stages:
        if stage == "review":
            break
        reason = None if stage in redo else stage_done(stage, slug, args.limit)
        if reason:
            print(f"\n— {stage}: пропускаю, {reason} (--redo {stage}, щоб заново)")
            continue
        if stage == "paintings":
            ok = run("collect_paintings.py", "--artist", slug)
        elif stage == "profiles":
            ok = run("profile_artworks.py", "--artist", slug, "--limit", str(args.limit), *model,
                     *(["--redo"] if "profiles" in redo else []))
        elif stage == "facts":
            ok = run("extract_facts.py", "extract", "--artist", slug, *model, *urls)
        else:
            ok = run("extract_bio.py", "extract", "--artist", slug, *model, *urls,
                     *(["--force"] if "bio" in redo else []))
        if not ok:
            failed.append(stage)

    print("\n=== Підсумок ===")
    print("Помилки на етапах: " + ", ".join(failed) if failed else "Усі етапи пройшли.")
    print("Чернетки: data/artwork_drafts/, data/facts_drafts/, data/bio_drafts/")
    if "review" in stages:
        return 0 if run("review_server.py", "--artist", slug, "--port", str(args.port)) else 1
    print(f"Перевірка: backend/.venv/bin/python data/scripts/review_server.py --artist {slug}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
