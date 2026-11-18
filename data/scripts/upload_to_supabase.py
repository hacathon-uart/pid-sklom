"""Seed JSON + images -> Supabase (tables and Storage). Owner: A — T04, T11.

Reads data/seed/{artists,artworks,facts}.json and data/images/, then:
  1. uploads every artwork image and thumbnail to the public bucket «artworks», and every
     artist portrait copied by extract_bio.py (data/images/portraits/) to the bucket «portraits»,
  2. upserts artists, artworks and facts (matched by `id`), with image_url / thumb_url /
     portrait_url rewritten from «images/<file>» to the public Storage URL.

Re-runnable: Storage files are overwritten and rows are upserted, nothing is duplicated.
The seed files stay the source of truth and keep their relative paths (local mode still works).

Skipped by default, so the live database holds only real content:
  - placeholder artworks (slug «stub-…») and the facts about them,
  - artists that have no artwork to upload (their bios are still placeholders).
Use --include-stubs / --all-artists to override.

Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment or in backend/.env.
The service key bypasses all security rules: never commit it, never put it in the frontend.
Run data/schema.sql in the Supabase SQL editor first.

    backend/.venv/bin/python data/scripts/upload_to_supabase.py --dry-run
    backend/.venv/bin/python data/scripts/upload_to_supabase.py
"""

import argparse
import json
import mimetypes
import os
import sys
from pathlib import Path

import httpx

DATA_DIR = Path(__file__).resolve().parents[1]
SEED = DATA_DIR / "seed"
BUCKET = "artworks"
PORTRAIT_BUCKET = "portraits"  # created by data/schema.sql


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    env_file = DATA_DIR.parent / "backend" / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip("\"'")
    env.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    return env


def read(name: str) -> list[dict]:
    return json.loads((SEED / f"{name}.json").read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="show what would be uploaded, change nothing")
    parser.add_argument("--include-stubs", action="store_true", help="also upload «stub-…» placeholder artworks")
    parser.add_argument("--all-artists", action="store_true", help="also upload artists without artworks")
    args = parser.parse_args()

    env = load_env()
    base = env.get("SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_KEY", "")
    if not args.dry_run and not (base and key):
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (environment or backend/.env).")
        return 2

    artists, artworks, facts = read("artists"), read("artworks"), read("facts")
    if not args.include_stubs:
        artworks = [w for w in artworks if not w["slug"].startswith("stub-")]
    ids = {w["id"] for w in artworks}
    if not args.all_artists:
        used = {w["artist_id"] for w in artworks}
        artists = [a for a in artists if a["id"] in used]
    facts = [f for f in facts if f.get("artwork_id") is None or f["artwork_id"] in ids]
    artist_ids = {a["id"] for a in artists}
    facts = [f for f in facts if f.get("artist_id") is None or f["artist_id"] in artist_ids]

    public = f"{base}/storage/v1/object/public/{BUCKET}"
    files: list[tuple[str, Path]] = []  # (bucket, local file)
    rows = []
    for w in artworks:
        row = dict(w)
        for col in ("image_url", "thumb_url"):
            rel = row.get(col)
            if rel and not rel.startswith("http"):
                path = DATA_DIR / rel
                if not path.exists():
                    print(f"  missing file for {w['slug']}: {rel}")
                    return 1
                files.append((BUCKET, path))
                row[col] = f"{public}/{path.name}"
        rows.append(row)
    # Artist portraits (data/images/portraits/, from extract_bio.py) have their own bucket.
    portraits_public = f"{base}/storage/v1/object/public/{PORTRAIT_BUCKET}"
    artists = [dict(a) for a in artists]
    for a in artists:
        rel = a.get("portrait_url")
        if rel and not rel.startswith("http"):
            path = DATA_DIR / rel
            if not path.exists():
                print(f"  missing portrait for {a['slug']}: {rel}")
                return 1
            files.append((PORTRAIT_BUCKET, path))
            a["portrait_url"] = f"{portraits_public}/{path.name}"
    print(f"{len(artists)} artists, {len(rows)} artworks, {len(facts)} facts, {len(files)} image files")
    if args.dry_run:
        for w in rows:
            print(f"  {w['id']:>4}  {w['review_status']:<8} {w['slug']}")
        return 0

    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    with httpx.Client(headers=headers, timeout=60) as http:
        for bucket, path in files:
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            r = http.post(
                f"{base}/storage/v1/object/{bucket}/{path.name}",
                content=path.read_bytes(),
                headers={"Content-Type": mime, "x-upsert": "true"},
            )
            if r.status_code >= 300:
                print(f"  upload FAILED {r.status_code}: {r.text}")
                if "bucket" in r.text.lower() and "not found" in r.text.lower():
                    print(f"  Bucket «{bucket}» does not exist yet: run the storage.buckets statement from")
                    print("  data/schema.sql in the Supabase SQL editor (it only adds missing buckets).")
                return 1
            print(f"  uploaded {bucket}/{path.name}")
        # Parents first: artworks reference artists, facts reference both.
        for table, data in (("artists", artists), ("artworks", rows), ("facts", facts)):
            if not data:
                continue
            r = http.post(
                f"{base}/rest/v1/{table}?on_conflict=id",
                json=data,
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            )
            if r.status_code >= 300:
                print(f"  {table} FAILED {r.status_code}: {r.text}")
                return 1
            print(f"  upserted {len(data)} rows into {table}")
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
