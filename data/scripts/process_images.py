"""Download artwork images, resize, store locally. Owner: A — T11.

For every row in data/seed/artworks.json whose image_url still points to the web
(Wikimedia Commons, set by import_profiles.py):
  1. Take the file the collector already downloaded (data/output/*/images/<wikidata_id>.*),
     or download image_url if there is none.
  2. Resize to 1200 px on the long side -> data/images/<slug>.jpg,
     and 400 px -> data/images/<slug>-thumb.jpg (JPEG, quality 85).
  3. Set image_url / thumb_url to those local paths. The backend serves them in
     DATA_BACKEND=local mode.

Re-runnable: rows that already have local images are skipped (use --force to redo them).
Supabase mode (upload to the «artworks» bucket) comes with Stage B of the ADR plan.

Needs Pillow, so run it with the backend environment:

    backend/.venv/bin/python data/scripts/process_images.py
    backend/.venv/bin/python data/scripts/process_images.py --dry-run
"""

import argparse
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

DATA_DIR = Path(__file__).resolve().parents[1]
SEED = DATA_DIR / "seed" / "artworks.json"
IMAGES_DIR = DATA_DIR / "images"
COLLECTOR_OUTPUT = DATA_DIR / "output"

# Wikimedia asks for a descriptive User-Agent. Generic project name only, no personal data.
USER_AGENT = "PidSklomDataBot/0.1 (educational hackathon project; public-domain paintings)"
SIZES = {"image": 1200, "thumb": 400}


def collector_file(wikidata_id: str | None) -> Path | None:
    if not wikidata_id or not COLLECTOR_OUTPUT.exists():
        return None
    for path in COLLECTOR_OUTPUT.glob(f"*/images/{wikidata_id}.*"):
        if path.is_file() and path.stat().st_size > 0:
            return path
    return None


def download(url: str, attempts: int = 3) -> bytes:
    for attempt in range(1, attempts + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read()
        except Exception as exc:  # network errors and HTTP 429/5xx: wait and retry
            if attempt == attempts:
                raise
            print(f"    retry {attempt} after error: {exc}")
            time.sleep(2 * attempt)
    raise AssertionError("unreachable")


def save_resized(img: Image.Image, long_side: int, path: Path) -> None:
    copy = img.copy()
    copy.thumbnail((long_side, long_side), Image.LANCZOS)  # keeps proportions, never upscales
    copy.save(path, "JPEG", quality=85, optimize=True, progressive=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="redo rows that already have local images")
    parser.add_argument("--dry-run", action="store_true", help="only list what would be processed")
    args = parser.parse_args()

    rows = json.loads(SEED.read_text(encoding="utf-8"))
    todo = [
        r for r in rows
        if not r["slug"].startswith("stub-")
        and (args.force or str(r.get("image_url") or "").startswith("http"))
    ]
    print(f"{len(todo)} of {len(rows)} artworks need images")
    if args.dry_run or not todo:
        for r in todo:
            print(f"  {r['id']:>4}  {r['slug']}")
        return 0

    IMAGES_DIR.mkdir(exist_ok=True)
    failed = []
    for r in todo:
        image_path = IMAGES_DIR / f"{r['slug']}.jpg"
        thumb_path = IMAGES_DIR / f"{r['slug']}-thumb.jpg"
        local = collector_file(r.get("wikidata_id"))
        try:
            if local:
                data, origin = local.read_bytes(), str(local.relative_to(DATA_DIR))
            elif str(r.get("image_url") or "").startswith("http"):
                data, origin = download(r["image_url"]), "download"
                time.sleep(0.5)  # be polite to Wikimedia
            else:
                raise ValueError("no web image_url and no collector file to work from")
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
            save_resized(img, SIZES["image"], image_path)
            save_resized(img, SIZES["thumb"], thumb_path)
        except Exception as exc:
            failed.append(r["slug"])
            print(f"  FAILED {r['slug']}: {exc}")
            continue
        r["image_url"] = f"images/{image_path.name}"
        r["thumb_url"] = f"images/{thumb_path.name}"
        print(f"  ok  {r['slug']}  {img.width}x{img.height} from {origin}")
        # Save after every image, so an interrupted run keeps its progress.
        SEED.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Done: {len(todo) - len(failed)} ok, {len(failed)} failed")
    if failed:
        print("Failed rows keep their web image_url, so the site still shows them. Re-run to retry.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
