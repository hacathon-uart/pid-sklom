# Supabase setup (free tier)

One project holds Postgres tables/vectors, Storage image files and (later) login.
There is no separate biography or vector database.
Schema: `data/schema.sql`. Current/future ownership: [data map](DATA_MODEL.md).
Decisions: [ADR 0001](adr/0001-artwork-data-storage.md) and
[ADR 0004](adr/0004-reviewed-enrichment-and-catalogue-authority.md).

## 1. Create the project (once, one person)

1. supabase.com → New project. Name `pidsklom`, region closest to Render (e.g. Frankfurt), free plan.
2. Save the **database password** in the team password manager. Nothing in this repo needs it.
3. For a new project, run `data/schema.sql` in the SQL editor. It creates tables,
   security rules, `artworks`/`memes` buckets and `artwork_embeddings vector(768)`.
   **For an existing project, review and back up first:** this version drops the
   old `artworks.embedding`, `embedding_model` and `match_artworks()` function.
   Re-running SQL is not a substitute for a reviewed migration/restore plan.
4. Project Settings → **API Keys**. You need three values:

| Value | Where it goes | Secret? |
|---|---|---|
| Project URL | `SUPABASE_URL` (backend) and `VITE_SUPABASE_URL` (frontend) | No |
| Publishable key (`sb_publishable_…`, or legacy `anon`) | `VITE_SUPABASE_ANON_KEY` (frontend) | No, it is meant for browsers; RLS protects the data |
| Secret key (`sb_secret_…`, or legacy `service_role`) | `SUPABASE_SERVICE_KEY` (backend only) | **Yes.** It bypasses all security rules |

## 2. Share the keys with the team

- Send the secret key through the password manager (1Password / Bitwarden shared vault), never Slack, Telegram, email or git.
- Each person puts it in their own `backend/.env` (gitignored).
- On deploy it goes into the Render dashboard (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY` are already declared in `render.yaml` with `sync: false`). The two public values go into the Render Static Site build when user login is enabled; never put the service key in a browser build.
- If it leaks: Project Settings → API Keys → rotate it, then update `.env` files and Render.

## 3. Load the data

```
backend/.venv/bin/python data/scripts/upload_to_supabase.py --dry-run
backend/.venv/bin/python data/scripts/upload_to_supabase.py
backend/.venv/bin/python data/scripts/embed_artworks.py --dry-run
backend/.venv/bin/python data/scripts/embed_artworks.py
```

The uploader stores images and upserts artists/artworks/facts. The embedding script
needs `AI_API_KEY` for uncached Gemini calls and writes vectors locally plus to
Supabase when configured. Defaults are `EMBEDDING_MODEL=gemini-embedding-2`,
`EMBEDDING_DIM=768`; the runtime must use the same model/dimension. Configure
`DATA_BACKEND=supabase`, `AI_PROVIDER=llm`, `MATCH_MODE=embeddings` for live matching.
Do not run imports or embedding batches on every container boot.

Today seeds are authoritative: re-run the relevant import/upload/embed steps after
content changes, then refresh/restart backend snapshots. The vector uploader
replaces model/dimension rows in multiple requests, so verify completeness after
failure before restarting live matching. The future admin workflow will replace
this with reviewed database-authoritative content, not blindly replay old seeds.

## Free-tier limits that matter

- Free projects may pause after a week of inactivity even below 500 MB. Check/resume
  the project before the demo; an always-on API does not prevent database pausing.
- 500 MB database and 1 GB file storage are separate quotas. Egress includes
  5 GB uncached plus 5 GB cached traffic. Track actual usage; the schema caps each
  application's Storage bucket file at 5 MiB even if the platform permits more.
- No automatic backups on Free. Seeds only reconstruct seed content; export live
  database data and copy Storage objects separately before they become valuable.
  Published provider sources: [research](RENDER_RESEARCH.md).
