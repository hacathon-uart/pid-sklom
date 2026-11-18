"""Pipeline stage «paintings»: Wikidata + Commons -> painting candidates -> data/artwork_drafts/<slug>.json.

Finds every painting of the artist on Wikidata (creator = artist, has an image), takes the file's
licence and size from Wikimedia Commons and screens it automatically:
  - the licence must be public domain / CC0 (the painting itself is old, but the photo must be free too);
  - the image must be at least MIN_SIDE px on its long side;
  - a painting with several images keeps the largest one.
Paintings already in data/seed/artworks.json are marked «in_catalogue» and skipped later.

Many paintings have a file on Commons but no Wikidata item. Those are taken from the artist's
Commons category (Wikidata P373): files right in the category and in its «… by <artist>»
subcategories. Their id is the Commons MediaInfo id («M12345») and the title comes from the file
name, so it has to be checked by a person (often it is Russian or has the artist's name in it).

Re-runnable: decisions you made on the review page (status, title, notes, profiles) are kept.
Usually started by enrich_artist.py; on its own:

    backend/.venv/bin/python data/scripts/collect_paintings.py --artist mykola-pymonenko
"""

import argparse
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402

from extract_facts import DATA_DIR, SEED, USER_AGENT, load_json, save_json, wiki_get  # noqa: E402

DRAFTS_DIR = DATA_DIR / "artwork_drafts"
MIN_SIDE = 800
FREE = ("public domain", "pd", "cc0")
SPARQL = """SELECT ?item ?uk ?en ?image ?inception ?collection ?genre WHERE {
  ?item wdt:P170 wd:%s; wdt:P18 ?image.
  ?item wdt:P31/wdt:P279* wd:Q3305213.
  OPTIONAL { ?item rdfs:label ?uk FILTER(lang(?uk)="uk") }
  OPTIONAL { ?item rdfs:label ?en FILTER(lang(?en)="en") }
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item wdt:P195 ?c. ?c rdfs:label ?collection FILTER(lang(?collection)="uk") }
  OPTIONAL { ?item wdt:P136 ?g. ?g rdfs:label ?genre FILTER(lang(?genre)="uk") }
}"""
KEEP = ("status", "note", "title_uk", "title_is_translation", "profile", "profile_error")  # survive a re-run


def draft_path(slug: str) -> Path:
    return DRAFTS_DIR / f"{slug}.json"


def artist_category(client: httpx.Client, artist_qid: str) -> str | None:
    ent = wiki_get(client, "https://www.wikidata.org/w/api.php", {
        "action": "wbgetentities", "ids": artist_qid, "props": "claims", "format": "json"})["entities"][artist_qid]
    cats = [c["mainsnak"]["datavalue"]["value"] for c in ent.get("claims", {}).get("P373", []) if "datavalue" in c["mainsnak"]]
    return cats[0] if cats else None


def category_files(client: httpx.Client, category: str) -> list[str]:
    """Image files in the category and in its «… by …» subcategories (not photos of houses or graves)."""
    out, todo, seen = [], [f"Category:{category}"], set()
    while todo:
        title = todo.pop()
        seen.add(title)
        res = wiki_get(client, "https://commons.wikimedia.org/w/api.php", {
            "action": "query", "list": "categorymembers", "cmtitle": title, "cmlimit": 500, "format": "json"})
        for m in res["query"]["categorymembers"]:
            if m["ns"] == 6 and m["title"].lower().endswith((".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp")):
                out.append(m["title"].split(":", 1)[1])
            elif m["ns"] == 14 and " by " in m["title"] and m["title"] not in seen:
                todo.append(m["title"])
    return list(dict.fromkeys(out))


def title_from_file(name: str, artist: dict) -> tuple[str, int | None]:
    """«Красицкий - Гость из Запорожья.jpg» -> («Гость из Запорожья», None); «… 1916.JPG» -> (…, 1916)."""
    stem = re.sub(r"\.[A-Za-z]+$", "", name).replace("_", " ")
    surname = artist["name_uk"].split()[-1]
    roots = {surname[:6], surname[:6].replace("и", "і"), surname[:6].replace("і", "и")}
    stem = re.sub(r"\(([^)]*)\)", lambda m: "" if any(r in m.group(1) for r in roots) else m.group(0), stem)
    for r in roots:
        stem = re.sub(rf"^{re.escape(r)}\w*(\s+[А-ЯІЇЄҐA-Z]\.?\s*[А-ЯІЇЄҐA-Z]\.?|\s+[А-ЯІЇЄҐA-Z]{{2}}\b)?\s*[-–—]?\s*", "", stem)
    year = None
    m = re.search(r"\b(1[6-9]\d\d)\b", stem)
    if m:
        year = int(m.group(1))
        stem = (stem[: m.start()] + stem[m.end():])
    return re.sub(r"\s+", " ", stem).strip(" -–—,"), year


def query_paintings(client: httpx.Client, artist_qid: str) -> dict[str, dict]:
    """QID -> {qid, uk, en, files, year, museum, genre}; one painting may come with several images."""
    for attempt in range(4):
        r = client.get("https://query.wikidata.org/sparql",
                       params={"query": SPARQL % artist_qid, "format": "json"}, timeout=90)
        if r.status_code != 429:
            break
        time.sleep(10 * (attempt + 1))
    r.raise_for_status()
    out: dict[str, dict] = {}
    for b in r.json()["results"]["bindings"]:
        v = {k: x["value"] for k, x in b.items()}
        qid = v["item"].rsplit("/", 1)[-1]
        p = out.setdefault(qid, {"qid": qid, "uk": None, "en": None, "files": set(), "year": None,
                                 "museum": None, "genre": None})
        p["files"].add(unquote(v["image"].rsplit("/", 1)[-1]))
        p["uk"] = p["uk"] or v.get("uk")
        p["en"] = p["en"] or v.get("en")
        p["museum"] = p["museum"] or v.get("collection")
        p["genre"] = p["genre"] or v.get("genre")
        if v.get("inception") and v["inception"][:4].lstrip("-").isdigit():
            p["year"] = p["year"] or int(v["inception"][:4])
    return out


def commons_info(client: httpx.Client, files: list[str]) -> dict[str, dict]:
    """Commons file name -> size, licence, 1280 px and 400 px URLs."""
    out: dict[str, dict] = {}
    # Batches of up to 25 files, but also short enough for a GET URL: long Cyrillic file names are
    # percent-encoded to ~6 bytes per letter, and Commons answers 414 «URI Too Long» past ~8 KB.
    batches, batch, size = [], [], 0
    for f in files:
        cost = len(quote(f"File:{f}|"))
        if batch and (len(batch) == 25 or size + cost > 5000):
            batches.append(batch)
            batch, size = [], 0
        batch.append(f)
        size += cost
    if batch:
        batches.append(batch)
    for chunk in batches:
        titles = "|".join(f"File:{f}" for f in chunk)
        data = {}
        for width in (1280, 400):
            res = wiki_get(client, "https://commons.wikimedia.org/w/api.php", {
                "action": "query", "titles": titles, "prop": "imageinfo", "iiprop": "url|size|extmetadata",
                "iiurlwidth": width, "format": "json", "formatversion": 2})
            for page in res["query"]["pages"]:
                info = (page.get("imageinfo") or [{}])[0]
                name = page["title"].split(":", 1)[1]
                meta = info.get("extmetadata", {})
                entry = data.setdefault(name, {
                    "width": info.get("width") or 0, "height": info.get("height") or 0,
                    "license": (meta.get("LicenseShortName") or {}).get("value", "").strip() or "невідомо",
                    "file_page": info.get("descriptionurl"), "original": info.get("url"), "pageid": page.get("pageid")})
                entry["image_url" if width == 1280 else "thumb_url"] = info.get("thumburl") or info.get("url")
            time.sleep(0.5)
        for name, entry in data.items():
            out[name] = entry
            out[name.replace("_", " ")] = entry
    return out


def collect(artist: dict, verbose: bool = True) -> dict:
    seed_qids = {w.get("wikidata_id") for w in load_json(SEED / "artworks.json", []) if w.get("wikidata_id")}
    with httpx.Client(timeout=60, headers={"User-Agent": USER_AGENT}) as client:
        found = query_paintings(client, artist["wikidata_id"])
        category = artist_category(client, artist["wikidata_id"])
        wd_files = {f.replace("_", " ") for p in found.values() for f in p["files"]}
        extra = [f for f in (category_files(client, category) if category else []) if f.replace("_", " ") not in wd_files]
        info = commons_info(client, sorted({f for p in found.values() for f in p["files"]} | set(extra)))
    for name in extra:  # Commons-only paintings: id = MediaInfo id
        i = info.get(name) or info.get(name.replace("_", " "))
        if not i or not i.get("pageid"):
            continue
        title, year = title_from_file(name, artist)
        found[f"M{i['pageid']}"] = {"qid": f"M{i['pageid']}", "uk": None, "en": None, "files": {name}, "year": year,
                                    "museum": None, "genre": None, "file_title": title}

    candidates, screened = [], []
    for p in found.values():
        title = p["uk"] or p["en"] or p.get("file_title") or p["qid"]
        files = [(f, info.get(f) or info.get(f.replace("_", " "))) for f in p["files"]]
        files = [(f, i) for f, i in files if i]
        if not files:
            screened.append({"qid": p["qid"], "title": title, "reason": "Commons не знайшов файл"})
            continue
        free = [(f, i) for f, i in files if i["license"].casefold().startswith(FREE)]
        if not free:
            screened.append({"qid": p["qid"], "title": title,
                             "reason": f"ліцензія файлу не суспільне надбання: {files[0][1]['license']}"})
            continue
        name, best = max(free, key=lambda fi: max(fi[1]["width"], fi[1]["height"]))
        if max(best["width"], best["height"]) < MIN_SIDE:
            screened.append({"qid": p["qid"], "title": title,
                             "reason": f"замале зображення {best['width']}×{best['height']}"})
            continue
        uk = p["uk"]
        surname = artist["name_uk"].split()[-1][:5]
        if uk and uk.endswith(")") and "(" in uk and surname in uk[uk.rindex("("):]:
            uk = uk[: uk.rindex("(")].strip()  # «Ідилія (Пимоненко)» is a Wikipedia disambiguation, not a title
        year, note = p["year"], ""
        born, died = artist.get("birth_year"), artist.get("death_year")
        if year and ((born and year < born + 8) or (died and year > died)):
            note = f"Wikidata дає рік {year}, а художник жив {born}–{died}: рік прибрано, перевір."
            year = None
        from_file = p["qid"].startswith("M")
        if from_file:
            note = (note + " " if note else "") + "Лише на Commons: назва взята з назви файлу, перевір і переклади українською."
        candidates.append({
            "qid": p["qid"],
            "title_uk": p.get("file_title") if from_file else uk,
            "title_en": p["en"],
            "title_is_translation": p["uk"] is None,
            "source": "commons" if from_file else "wikidata",
            "year": year,
            "museum": p["museum"],
            "genre": p["genre"],
            "commons_file": name,
            "commons_file_page": best["file_page"],
            "image_url": best["image_url"],
            "thumb_url": best["thumb_url"],
            "width": best["width"],
            "height": best["height"],
            "license": best["license"],
            "wikidata_url": None if from_file else f"https://www.wikidata.org/wiki/{p['qid']}",
            "in_catalogue": p["qid"] in seed_qids,
            "status": "approved" if p["qid"] in seed_qids else "pending",
            "note": note,
            "profile": None,
            "profile_error": None,
        })

    path = draft_path(artist["slug"])
    old = {c["qid"]: c for c in load_json(path, {}).get("candidates", [])}
    for c in candidates:
        if c["qid"] in old and not c["in_catalogue"]:
            for k in KEEP:
                if old[c["qid"]].get(k) is not None:
                    c[k] = old[c["qid"]][k]
    # Good candidates first: Ukrainian title, then bigger image.
    candidates.sort(key=lambda c: (c["in_catalogue"], c["title_is_translation"], -max(c["width"], c["height"])))
    draft = {
        "artist_id": artist["id"],
        "artist": artist["name_uk"],
        "artist_qid": artist["wikidata_id"],
        "collected_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "candidates": candidates,
        "screened_out": screened,
    }
    save_json(path, draft)
    if verbose:
        new = [c for c in candidates if not c["in_catalogue"]]
        print(f"{artist['name_uk']}: знайдено {len(found)} картин із зображенням (Wikidata + Commons)")
        print(f"  пройшли скринінг: {len(candidates)} (уже в каталозі {len(candidates) - len(new)}, нових {len(new)})")
        for s in screened:
            print(f"  ✗ {s['title']}: {s['reason']}")
        print(f"Чернетка: {path}")
    return draft


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--artist", required=True, help="slug з data/seed/artists.json")
    args = parser.parse_args()
    artist = next((a for a in load_json(SEED / "artists.json", []) if a["slug"] == args.artist), None)
    if not artist:
        print(f"Художника {args.artist!r} немає в data/seed/artists.json")
        return 1
    if not artist.get("wikidata_id"):
        print("У художника немає wikidata_id — без нього картини не знайти.")
        return 1
    collect(artist)
    return 0


if __name__ == "__main__":
    sys.exit(main())
