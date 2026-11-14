"""Download artwork images, resize, upload. Owner: A — T11.

For each artwork row with a Wikimedia Commons file URL:
  1. Download the original (public domain only! keep source_url + license).
  2. Resize to 1200 px on the long side -> image, 400 px -> thumb (Pillow, JPEG q=85).
  3. Local mode: save to data/images/<slug>.jpg and <slug>-thumb.jpg, set image_url/thumb_url.
     Supabase mode: upload to the public bucket «artworks», store the public URLs.

Wikimedia asks for a descriptive User-Agent — use a generic project name, not personal emails.

    python data/scripts/process_images.py [--supabase]
"""

raise SystemExit("TODO: not implemented yet (T11)")
