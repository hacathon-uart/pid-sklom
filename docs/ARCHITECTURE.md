# Architecture and code map

```
 Browser (React, Vercel) ──HTTP──► FastAPI (Render) ──► Repository ──► seed JSON  |  Supabase Postgres + Storage
        │                            │  ├─ services/create.py ──► AIProvider ──► stub (tag matching)  |  LLM
        └── Supabase Auth (login)    │  └─ render/meme.py (Pillow)
 Telegram ──webhook──────────────────┘     bot/handlers.py uses the SAME services as the API
```

## Stubs: everyone can work from day one

Every external dependency sits behind a switch in `backend/.env`. Each defaults to a local stub, so nobody waits for anybody else.

| Switch | Stub (default) | Real | Owner |
|---|---|---|---|
| `DATA_BACKEND` | `local`: reads `data/seed/*.json`, serves `data/images/`, memes in `backend/media/` | `supabase`: `data/supabase_repo.py` | A |
| `AI_PROVIDER` | `stub`: word matching + `fallback_captions` | `llm`: `ai/llm.py` + `ai/prompts.py` | A |
| `AUTH_MODE` | `stub`: any bearer token = user id; frontend has a fake «Увійти» | `supabase`: JWT check in `auth.py`, Supabase SDK in `frontend/src/auth/` | A + B |
| `TELEGRAM_BOT_TOKEN` | empty = bot off | set = webhook on Render, `python -m app.bot.polling` locally | D |

The AI stub **is the production fallback** (plan §4). When the LLM errors or takes longer than 8 s, `services/create.py` uses it automatically, and the response says `"source": "fallback"`.

## Where things live

```
backend/app/
  main.py            FastAPI app, CORS, routers, static files (local mode)
  config.py          all env vars
  schemas.py         ★ API contract (JSON shapes)
  auth.py            current_user / optional_user
  api/               thin HTTP routes: content.py, create.py, memes.py
  services/create.py ★ Flow A (match_phrase) + Flow B (suggest_captions), timeouts, fallback, cache
  data/              Repository interface + local / supabase implementations
  ai/                provider interface, stub, llm (TODO), prompts, moderation
  render/meme.py     Pillow renderer + fonts/ (same TTFs as the browser)
  bot/               aiogram handlers, webhook route, local polling runner
backend/tests/       pytest smoke tests for every endpoint

frontend/src/
  api/               client.ts (fetch + auth header), types.ts (★ mirror of schemas.py), useApi hook
  auth/              AuthContext (fake login until Supabase is wired), supabase client
  components/        design-system pieces named as in Figma: Button, IconButton, Input, Tag, Sidebar,
                     Artwork, ArtworkCard, AuthorCard, MemeCard, Portrait, StoryCard, ModeSwitch, Layout
  editor/            MemeCanvas (react-konva), CaptionControls (3b panel), MemeWorkspace (shared
                     result layout + save), useMemeDraft (editor state), exportPng (PNG + watermark)
  pages/             one file per screen (numbers = docs/design/README.md)
  styles/tokens.css  design tokens as Tailwind @theme → bg-accent, text-text-secondary, rounded-card…

data/
  seed/*.json        content in the same columns as the DB (placeholder rows marked «ЗАГЛУШКА»)
  images/            placeholder PNGs (scripts/make_placeholders.py)
  schema.sql         Supabase tables
  scripts/           make_placeholders (works), import_sheet / process_images / profile_artworks (TODO)
```

## Routes (frontend)

| URL | Screen |
|---|---|
| `/` | 1 Головна |
| `/create` | 2 Конструктор: введення |
| `/create/result?q=&d=` | 3 Результат + 3b Редагування (toggle on the same page) |
| `/create/painting?artwork=` | 2b Вибір картини |
| `/create/painting/:id/ai` | 3c Підписи від ШІ |
| `/create/painting/:id/own` | 3d Свій підпис |
| `/me` | 4 Мої меми |
| `/me/memes/:id` and `/me/memes/:id/edit` | 4b Перегляд, editing a saved meme |
| `/m/:id` | public share page (US-16) |
| `/gallery`, `/artists`, `/artists/:slug` | 5 Галерея, artists list, 5b Автор |

## Who starts where (Day 1–2)

- **A (Backend + AI):** `ai/llm.py` + `ai/prompts.py` (T05, T13, T17), `data/supabase_repo.py` + `data/schema.sql` (T04), moderation + rate limit (T21), `data/scripts/process_images.py` and `profile_artworks.py` (T11, T12).
- **B (Frontend):** pages are wired to the stub API and look roughly like Figma. Polish them, then the editor TODOs in `editor/MemeCanvas.tsx` (resize handles, touch), mobile (US-11), Supabase login (T22).
- **C (Content):** fill `data/seed/*.json` (or the Google Sheet + `import_sheet.py`). Restart the backend and the site shows new content without code changes. Replace every «ЗАГЛУШКА».
- **D (Bot + DevOps):** deploy with `render.yaml` + Vercel (T02, T03), BotFather token, `bot/handlers.py` (T19, T26), extra fonts in `render/fonts/` (T16).

## Gotchas already hit

- **CORS and canvas export.** Every artwork `<img>` must have `crossOrigin="anonymous"` (done in `Artwork.tsx`). Otherwise the browser caches a non-CORS copy of the image, and the Konva editor then fails to load the same URL; it shows an empty canvas. Supabase Storage public buckets send CORS headers, so this keeps working after the switch.
- **Fonts in Konva.** The canvas measures text once, so `MemeCanvas` re-renders after `document.fonts.load()`. Each meme font must also be in the Google Fonts link in `index.html` **and** in `backend/app/render/fonts/` + `FONT_FILES`.
- **Render free tier** sleeps after about 15 minutes, and its disk is wiped on every deploy. In `DATA_BACKEND=local` mode, saved memes on Render disappear after a redeploy. That's fine for testing; switch to Supabase before the demo.
- **Python 3.11** (Render default in `render.yaml`), so no 3.12-only syntax.

## Open questions from the design review

Gaps between the plan, the Figma screens and the DB schema. The code takes the noted default; decide as a team.

1. **The artwork needs more fields than the plan's table.** The StoryCard shows «Про картину», the gallery filters by Портрет/Пейзаж/Побут/Авангард, and the author page shows «полотно, олія» and a «найвідоміша картина». So `about_uk`, `genre`, `medium` and `is_featured` were added to `artworks` (`schema.sql`, seed). **C:** please fill them.
2. ~~«Подобається» (heart) on an unsaved meme~~ — decided: the heart saves the meme to the account (asks to log in first), same as «Зберегти в «Мої меми»».
3. **The refresh icon next to the caption on screen 3.** Regenerate the caption, or another painting? Currently it means «Інша картина», as on 3b.
4. **There is no artwork detail screen.** The gallery says «Натисніть на картину, щоб прочитати її історію…». Currently a click opens 2b with the painting preselected.
5. **The «Усі автори» page (US-09, Must) is not designed.** `/artists` is a simple placeholder grid.
6. **Not designed yet:** the login dialog, mobile layouts (US-11 is Must), and loading/empty/error states (simple placeholders exist in `Layout.tsx`).
7. **Meme privacy.** `GET /api/memes/{id}` is readable by anyone with the link, to make share links simple. Is that OK, or do we add an `is_public` flag?
8. **«Інша картина» in Flow A** cycles through the Top-5 without a new AI call. Is that enough for US-01?
