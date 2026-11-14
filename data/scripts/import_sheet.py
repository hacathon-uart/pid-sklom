"""Google Sheet (tabs: Artists, Artworks, Facts) -> data/seed/*.json and/or Supabase. Owner: A/C — T11.

Plan:
  1. Publish each tab as CSV (File → Share → Publish to web → CSV) and put the URLs in env vars.
  2. Read with csv.DictReader; column names = DB column names (see data/schema.sql).
     List columns (tags, fallback_captions, sources, situations) are separated by « | ».
  3. Write data/seed/*.json (local mode) — the backend picks them up on restart.
  4. With --supabase: upsert rows by id (re-runnable, updates instead of duplicating).

    python data/scripts/import_sheet.py [--supabase]
"""

raise SystemExit("TODO: not implemented yet (T11)")
