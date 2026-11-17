# Supabase setup (free tier)

One project holds the tables, the image files and (later) login. Schema: `data/schema.sql`. Why: `docs/adr/0001-artwork-data-storage.md`.

## 1. Create the project (once, one person)

1. supabase.com → New project. Name `pidsklom`, region closest to Render (e.g. Frankfurt), free plan.
2. Save the **database password** in the team password manager. Nothing in this repo needs it.
3. SQL editor → paste all of `data/schema.sql` → Run. It is re-runnable. It creates the tables, security rules, the `artworks` and `memes` buckets, and `match_artworks()`.
4. Project Settings → **API Keys**. You need three values:

| Value | Where it goes | Secret? |
|---|---|---|
| Project URL | `SUPABASE_URL` (backend) and `VITE_SUPABASE_URL` (frontend) | No |
| Publishable key (`sb_publishable_…`, or legacy `anon`) | `VITE_SUPABASE_ANON_KEY` (frontend) | No, it is meant for browsers; RLS protects the data |
| Secret key (`sb_secret_…`, or legacy `service_role`) | `SUPABASE_SERVICE_KEY` (backend only) | **Yes.** It bypasses all security rules |

## 2. Share the keys with the team

- Send the secret key through the password manager (1Password / Bitwarden shared vault), never Slack, Telegram, email or git.
- Each person puts it in their own `backend/.env` (gitignored).
- On deploy it goes into the Render dashboard (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY` are already declared in `render.yaml` with `sync: false`). The two public values go into Vercel.
- If it leaks: Project Settings → API Keys → rotate it, then update `.env` files and Render.

## 3. Load the data

```
backend/.venv/bin/python data/scripts/upload_to_supabase.py --dry-run
backend/.venv/bin/python data/scripts/upload_to_supabase.py
```

It uploads the images to the bucket and upserts artists, artworks and facts. Re-run it after every change to `data/seed/*.json`.

## Free-tier limits that matter

- **A project with no activity for 7 days is paused.** Open it or ping it before the demo, and check it the day you present.
- 500 MB database, 1 GB file storage, 5 GB traffic per month, 50 MB max file size. Our content is well under this.
- No automatic backups. The seed JSON files are the backup.
