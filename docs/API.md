# API contract (T09)

Base URL: `http://localhost:8000` locally, Render URL in production. Interactive docs: **`/docs`** (Swagger, always up to date).

The source of truth is [`backend/app/schemas.py`](../backend/app/schemas.py), mirrored in [`frontend/src/api/types.ts`](../frontend/src/api/types.ts). **Change both in the same PR.**

Errors are always `{"detail": "<message in Ukrainian, safe to show the user>"}`. A `422` on `POST /matches` or `POST /artworks/{id}/captions` with a string `detail` is a moderation refusal (US-13); show it as is.

Auth: `Authorization: Bearer <token>`. With `AUTH_MODE=stub` any token works and becomes the user id (the frontend's fake login sends `dev`). With `AUTH_MODE=supabase` it is the Supabase access token.
The initial public deployment uses `AUTH_MODE=disabled`: account listing, saving,
editing and deletion return `403`, even with a bearer token. Public reads remain available.

## Endpoints

| Method | Path | Auth | Screen | Purpose |
|---|---|---|---|---|
| GET | `/api/health` | – | – | Status + which stubs are active |
| GET | `/api/ready` | – | – | `200` after startup validates configuration, nonempty catalogue and configured embedding coverage; otherwise `503` |
| GET | `/api/artists` | – | 5, artists list | `ArtistSummary[]` |
| GET | `/api/artists/{slug}` | – | 5b | `ArtistDetail`: long bio, facts, featured artwork, all works |
| GET | `/api/artworks?q=&genre=&artist=&random=&limit=&offset=` | – | 5, 2b | `{items: ArtworkSummary[], total}`. `genre` ∈ `portrait, landscape, everyday, avantgarde`. `random=true` returns one random item («Випадкова картина», bot `/random`) |
| GET | `/api/artworks/{id}` | – | 3c, 3d, Top-5 click | `ArtworkDetail` incl. default `story` |
| POST | `/api/matches` | – | 2 → 3 | Flow A: creates a match. `{phrase, description?}` → `MatchResult` (201) |
| POST | `/api/artworks/{id}/captions` | – | 3c | Flow B: generates captions. `{exclude: string[]}` → `CaptionsResult` (3 options, 201) |
| GET | `/api/memes?favorite=` | ✔ | 4 | My memes, newest first |
| POST | `/api/memes` | ✔ | «Зберегти» | `{artwork_id, style, image_data_url}` → `Meme` (201) |
| GET | `/api/memes/{id}` | – | 4b, `/m/{id}` | Anyone with the link can read (UUID ids) |
| PATCH | `/api/memes/{id}` | owner | 4b heart, edit | `{style?, image_data_url?, is_favorite?}` |
| DELETE | `/api/memes/{id}` | owner | 4b | 204 |
| POST | `/telegram/webhook/{secret}` | secret | – | Telegram updates (not for the frontend) |

## Key shapes

```jsonc
// POST /api/matches  {"phrase": "коли дедлайн завтра", "description": "осінь, сум"}
{
  "artwork":  { "id": 3, "slug": "...", "title": "...", "year": 1880, "genre": "landscape",
                "image_url": "https://…", "thumb_url": "https://…",
                "artist": { "id": 2, "slug": "arkhyp-kuindzhi", "name": "Архип Куїнджі",
                            "birth_year": 1841, "death_year": 1910, "portrait_url": null } },
  "story":    { "museum": "…", "about_artwork": "…",
                "artwork_fact": { "id": 9, "text": "…", "source_url": "…" },
                "artist_fact":  { "id": 3, "text": "…", "source_url": "…" },
                "source_url": "…" },
  "caption":  "коли дедлайн завтра",      // = the phrase
  "position": "bottom",                   // top | middle | bottom (AI suggestion)
  "reason":   "…",
  "alternatives": [ { "artwork": {…}, "score": 0.91 }, … ],  // Top-5, [0] = chosen; score may be null
  "source":   "ai"                        // "fallback" = AI failed/disabled, tag matching used
}

// POST /api/artworks/3/captions  {"exclude": ["…already shown…"]}
{ "artwork_id": 3, "source": "ai",
  "captions": [ { "text": "…", "kind": "everyday" }, { "text": "…", "kind": "work" }, { "text": "…", "kind": "story" } ] }
```

### `MemeStyle`, shared by the browser editor and the Pillow renderer

```jsonc
{ "blocks": [            // 1–2 blocks (US-04)
  { "text": "Коли дедлайн завтра",
    "font": "Oswald",    // Oswald | Rubik | Montserrat | Lobster | Comfortaa
    "size": 40,          // px at REFERENCE_WIDTH = 600 px image width
    "color": "#FFFFFF",
    "outline": true,
    "position": "bottom",// preset, used when x/y are null
    "x": null, "y": null,// top-left of the text box, relative 0..1 (set after dragging)
    "width": null }      // relative 0..1, default 0.9
  ],
  "frame": "gold"        // gold | gallery | oak | mat — frame shown around the meme on the site;
}                        // the stored PNG is always frameless (frame is added only on «Завантажувати з рамкою»)
```

Text is always drawn **uppercase, centred, line height 1.1, black stroke = size/12**. Keep `MemeCanvas.tsx` and `render/meme.py` in sync.
