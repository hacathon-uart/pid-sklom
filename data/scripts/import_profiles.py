"""AI meme profiles -> data/seed/artworks.json. Owner: A/C — T11, T12.

Reads the profile file written by the vision-model run (data/artworks_meme_descriptions.json,
one object per painting, format in docs/adr/0001-artwork-data-storage.md) and upserts one
row per painting into data/seed/artworks.json. The backend reads that file in
DATA_BACKEND=local mode, and the same file is later upserted into Supabase.

Re-runnable. Rows are matched by `wikidata_id`, so a painting keeps its numeric id forever.

Who owns which field:
  - The profile file owns the AI fields and the review status. They are overwritten on every
    run: meme_profile, tags, review_status, is_sensitive, meme_potential, embedding_text,
    source_url, artist_id. To approve a painting, set review.status to "approved" in the
    profile file and run this script again.
  - Editorial fields (slug, title_uk, year, museum, medium, genre, about_uk, image_url,
    thumb_url, license, is_featured, fallback_captions) are filled only when a row is first
    created. After that, edit them in data/seed/artworks.json and the import keeps your edits.

Placeholder rows (slug «stub-…») of an artist are removed once that artist has real paintings,
together with the placeholder facts about those rows.

    python data/scripts/import_profiles.py             # write data/seed/*.json
    python data/scripts/import_profiles.py --dry-run   # only show what would change
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1]
REVIEW_STATUSES = {"pending", "approved", "rejected"}

# Keys of the profile file that go into the `meme_profile` jsonb column.
PROFILE_KEYS = [
    "visual_description",
    "people",
    "mood",
    "meme_situations",
    "do_not_use_for",
    "caption_position",
    "confidence",
    "model",
    "prompt_version",
    "generated_at",
]

# Every artwork row has exactly these keys, in this order (= columns of `artworks` in
# data/schema.sql, vectors live in artwork_embeddings, see ADR 0002).
ROW_DEFAULTS = {
    "id": None,
    "wikidata_id": None,
    "slug": None,
    "artist_id": None,
    "title_uk": None,
    "year": None,
    "museum": None,
    "medium": None,
    "genre": None,
    "about_uk": "",
    "image_url": None,
    "thumb_url": None,
    "license": None,
    "source_url": None,
    "is_featured": False,
    "tags": [],
    "meme_profile": None,
    "review_status": "pending",
    "is_sensitive": False,
    "meme_potential": None,
    "fallback_captions": [],
    "embedding_text": None,
}


def load(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, rows: list[dict], one_per_line: bool = False) -> None:
    if one_per_line:  # keeps the compact style of facts.json
        body = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows)
        text = f"[\n{body}\n]\n"
    else:
        text = json.dumps(rows, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")


def norm(name: str) -> str:
    return " ".join(name.lower().replace("’", "'").replace("ʼ", "'").split())


def normalize_row(row: dict) -> dict:
    """Give every row all columns, and convert the old placeholder profile format."""
    out = {key: row.get(key, list(default) if isinstance(default, list) else default)
           for key, default in ROW_DEFAULTS.items()}
    profile = out["meme_profile"]
    if profile and "situations" in profile:  # old format: {description, mood: str, situations}
        out["meme_profile"] = {
            "visual_description": profile.get("description", ""),
            "mood": [m.strip() for m in profile.get("mood", "").split(",") if m.strip()],
            "meme_situations": profile.get("situations", []),
        }
    if out["slug"] and out["slug"].startswith("stub-") and "review_status" not in row:
        out["review_status"] = "approved"  # placeholders are hand-written by the team
    return out


def check_profile(p: dict, artist_ids: dict[str, int]) -> list[str]:
    errors = []
    qid = p.get("artwork_id") or "?"
    if not str(qid).startswith("Q"):
        errors.append(f"{qid}: artwork_id must be a Wikidata id like Q111822246")
    if not p.get("title_uk"):
        errors.append(f"{qid}: title_uk is empty")
    if norm(p.get("artist", "")) not in artist_ids:
        errors.append(f"{qid}: artist «{p.get('artist')}» is not in data/seed/artists.json")
    if not p.get("meme_situations"):
        errors.append(f"{qid}: meme_situations is empty")
    status = (p.get("review") or {}).get("status", "pending")
    if status not in REVIEW_STATUSES:
        errors.append(f"{qid}: review.status «{status}» must be one of {sorted(REVIEW_STATUSES)}")
    potential = p.get("meme_potential")
    if potential is not None and not (isinstance(potential, int) and 1 <= potential <= 5):
        errors.append(f"{qid}: meme_potential must be 1–5")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--profiles", type=Path, default=DATA_DIR / "artworks_meme_descriptions.json")
    parser.add_argument("--seed-dir", type=Path, default=DATA_DIR / "seed")
    parser.add_argument("--dry-run", action="store_true", help="show the changes without writing files")
    args = parser.parse_args()

    artists = load(args.seed_dir / "artists.json")
    artworks = [normalize_row(r) for r in load(args.seed_dir / "artworks.json")]
    facts = load(args.seed_dir / "facts.json")
    profiles = load(args.profiles)

    artist_ids = {norm(a["name_uk"]): a["id"] for a in artists}
    artist_slugs = {a["id"]: a["slug"] for a in artists}

    errors = [e for p in profiles for e in check_profile(p, artist_ids)]
    dupes = [q for q, n in Counter(p.get("artwork_id") for p in profiles).items() if n > 1]
    errors += [f"{q}: appears more than once in the profile file" for q in dupes]
    if errors:
        print("Nothing written. Fix these first:", *errors, sep="\n  ", file=sys.stderr)
        return 1

    by_qid = {r["wikidata_id"]: r for r in artworks if r["wikidata_id"]}
    next_id = max((r["id"] for r in artworks), default=0) + 1
    added, updated = [], []

    for p in profiles:
        qid = p["artwork_id"]
        artist_id = artist_ids[norm(p["artist"])]
        source = p.get("source") or {}
        row = by_qid.get(qid)

        if row is None:  # first import: fill the editorial fields once
            situations = p["meme_situations"]
            row = normalize_row({})
            row.update(
                id=next_id,
                wikidata_id=qid,
                slug=f"{artist_slugs[artist_id]}-{qid.lower()}",
                title_uk=p["title_uk"],
                year=p.get("year"),
                image_url=source.get("image_url"),  # Wikimedia for now; process_images.py makes local copies
                thumb_url=source.get("image_url"),
                license="public domain",  # the collector keeps only public-domain files
                fallback_captions=[] if p.get("is_sensitive") else [s[:1].upper() + s[1:] for s in situations[:3]],
            )
            next_id += 1
            artworks.append(row)
            by_qid[qid] = row
            added.append(row)
        else:
            updated.append(row)

        # Fields owned by the profile file: overwritten on every run.
        row.update(
            artist_id=artist_id,
            source_url=source.get("commons_file_page") or row["source_url"],
            tags=p.get("tags", []),
            meme_profile={key: p.get(key) for key in PROFILE_KEYS}
            | {"review": {k: v for k, v in (p.get("review") or {}).items() if k != "status"}},
            review_status=(p.get("review") or {}).get("status", "pending"),
            is_sensitive=bool(p.get("is_sensitive")),
            meme_potential=p.get("meme_potential"),
            embedding_text=p.get("embedding_text"),
        )

    # Drop placeholders of artists that now have real paintings.
    real_artists = {r["artist_id"] for r in artworks if r["wikidata_id"]}
    stubs = [r for r in artworks if r["slug"].startswith("stub-") and r["artist_id"] in real_artists]
    stub_ids = {r["id"] for r in stubs}
    artworks = sorted((r for r in artworks if r["id"] not in stub_ids), key=lambda r: r["id"])
    dropped_facts = [f for f in facts if f.get("artwork_id") in stub_ids]
    facts = [f for f in facts if f.get("artwork_id") not in stub_ids]

    print(f"Profiles read: {len(profiles)} from {args.profiles.name}")
    print(f"  added:   {len(added)}" + (f"  (ids {added[0]['id']}–{added[-1]['id']})" if added else ""))
    print(f"  updated: {len(updated)}")
    if stubs:
        print(f"  removed placeholders: {', '.join(r['slug'] for r in stubs)} (+{len(dropped_facts)} facts)")
    status = Counter(r["review_status"] for r in artworks if r["wikidata_id"])
    print("  review status of real paintings: " + ", ".join(f"{k} {v}" for k, v in sorted(status.items())))
    print(f"Total artworks in seed: {len(artworks)}")

    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    save(args.seed_dir / "artworks.json", artworks)
    if dropped_facts:
        save(args.seed_dir / "facts.json", facts, one_per_line=True)
    print(f"Written to {args.seed_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
