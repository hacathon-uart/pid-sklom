"""Artwork texts -> Gemini embeddings (ADR 0002). Owner: A — T13.

For every artwork in data/seed/artworks.json that is not rejected and not a «stub-…» placeholder:
  - «whole»     : embedding_text (title, artist, description, mood, situations, tags)
  - «situation» : each meme situation
  - «avoid»     : each do_not_use_for rule (guards sensitive works)

Writes data/embeddings/vectors.json (gitignored; used in DATA_BACKEND=local) and, when Supabase
keys are set, replaces the rows of this model/dim in the `artwork_embeddings` table.

Re-runnable and incremental: a text is re-embedded only when its text, the model or the size
changed. The free tier is slow on purpose (small batches + waits on HTTP 429), so a full run
for ~150 artworks takes 15–20 minutes; a few edited profiles take seconds.

Order after editing profiles:
    python3 data/scripts/import_profiles.py
    backend/.venv/bin/python data/scripts/upload_to_supabase.py
    backend/.venv/bin/python data/scripts/embed_artworks.py
then restart the backend.

    backend/.venv/bin/python data/scripts/embed_artworks.py --dry-run
    backend/.venv/bin/python data/scripts/embed_artworks.py --local-only   # skip Supabase
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DATA_DIR.parent / "backend"))

import httpx  # noqa: E402

from app.ai.gemini import embed_documents  # noqa: E402
from app.config import Settings  # noqa: E402


def text_hash(kind: str, text: str) -> str:
    return hashlib.sha1(f"{kind}|{text}".encode()).hexdigest()[:16]


def wanted_texts(artworks: list[dict]) -> list[dict]:
    rows = []
    for w in artworks:
        if w.get("review_status") == "rejected" or w["slug"].startswith("stub-"):
            continue
        profile = w.get("meme_profile") or {}
        items = [("whole", w.get("embedding_text"))]
        items += [("situation", s) for s in profile.get("meme_situations") or []]
        items += [("avoid", s) for s in profile.get("do_not_use_for") or []]
        for kind, text in items:
            if text and text.strip():
                rows.append({"artwork_id": w["id"], "kind": kind, "text": text.strip(), "text_hash": text_hash(kind, text.strip())})
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="only count what would be embedded")
    parser.add_argument("--local-only", action="store_true", help="do not write to Supabase")
    args = parser.parse_args()

    s = Settings()
    artworks = json.loads((DATA_DIR / "seed" / "artworks.json").read_text(encoding="utf-8"))
    rows = wanted_texts(artworks)

    cache_file = s.embeddings_file
    cached: dict[tuple, list[float]] = {}
    if cache_file.exists():
        old = json.loads(cache_file.read_text(encoding="utf-8"))
        if old.get("model") == s.embedding_model and old.get("dim") == s.embedding_dim:
            cached = {(r["artwork_id"], r["kind"], r["text_hash"]): r["embedding"] for r in old["rows"]}
    todo = [r for r in rows if (r["artwork_id"], r["kind"], r["text_hash"]) not in cached]
    n_art = len({r["artwork_id"] for r in rows})
    print(f"{s.embedding_model}, {s.embedding_dim} dims: {len(rows)} texts for {n_art} artworks, {len(todo)} to embed")
    if args.dry_run:
        return 0
    if todo and not s.ai_api_key:
        print("Set AI_API_KEY (Gemini key) in backend/.env")
        return 2

    def save() -> None:
        keep = [{**r, "embedding": cached[(r["artwork_id"], r["kind"], r["text_hash"])]}
                for r in rows if (r["artwork_id"], r["kind"], r["text_hash"]) in cached]
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps({"model": s.embedding_model, "dim": s.embedding_dim, "rows": keep}), encoding="utf-8")

    # Embed in chunks of 100 and save after each, so an interrupted run keeps its progress.
    for start in range(0, len(todo), 100):
        chunk = todo[start : start + 100]
        vectors = embed_documents(
            [r["text"] for r in chunk], api_key=s.ai_api_key, model=s.embedding_model, dim=s.embedding_dim,
            on_batch=lambda done, total, base=start: print(f"  embedded {base + done}/{len(todo)}", flush=True),
        )
        for r, v in zip(chunk, vectors):
            cached[(r["artwork_id"], r["kind"], r["text_hash"])] = [round(float(x), 6) for x in v]
        save()
    save()  # also drops vectors of removed texts
    print(f"Local copy: {cache_file}")

    if args.local_only or not (s.supabase_url and s.supabase_service_key):
        print("Supabase skipped" + ("" if args.local_only else " (no SUPABASE_URL / SUPABASE_SERVICE_KEY)"))
        return 0
    base = f"{s.supabase_url.rstrip('/')}/rest/v1/artwork_embeddings"
    headers = {"apikey": s.supabase_service_key, "Authorization": f"Bearer {s.supabase_service_key}"}
    payload = [{**r, "model": s.embedding_model, "dim": s.embedding_dim, "embedding": cached[(r["artwork_id"], r["kind"], r["text_hash"])]}
               for r in rows]
    with httpx.Client(headers=headers, timeout=120) as http:
        # Replace this model's rows: simplest way to also drop vectors of edited or removed texts.
        r = http.delete(base, params={"model": f"eq.{s.embedding_model}", "dim": f"eq.{s.embedding_dim}"})
        if r.status_code >= 300:
            print(f"  Supabase delete FAILED {r.status_code}: {r.text[:300]}")
            return 1
        for start in range(0, len(payload), 200):
            r = http.post(base, json=payload[start : start + 200], headers={"Prefer": "return=minimal"})
            if r.status_code >= 300:
                print(f"  Supabase insert FAILED {r.status_code}: {r.text[:300]}")
                return 1
    print(f"Supabase: {len(payload)} rows in artwork_embeddings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
