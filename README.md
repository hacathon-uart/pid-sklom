# Під склом

Мистецтво крізь жарти. Write a phrase and get a meme made from a public-domain Ukrainian painting, plus the story behind it. Website + Telegram bot.

## License

The project's original code, documentation, and design assets are **all rights reserved**; see [LICENSE](LICENSE). Third-party material, including the Oswald font and sourced artwork, retains its own license or copyright status.

- Plan: [docs/Hachaton_plan.md](docs/Hachaton_plan.md)
- Design: [docs/design/README.md](docs/design/README.md)
- **Code map, stubs, who starts where, open questions:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **API contract:** [docs/API.md](docs/API.md) (live docs at http://localhost:8000/docs)
- **Render deployment gaps and release checklist:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **Data stores and future admin enrichment:** [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- **Telegram bot implementation handoff:** [docs/TELEGRAM_HANDOFF.md](docs/TELEGRAM_HANDOFF.md)
- **Telegram test and release procedure:** [docs/TELEGRAM_TESTING.md](docs/TELEGRAM_TESTING.md)
- **Telegram restricted production rollout:** [docs/TELEGRAM_PRODUCTION_HANDOFF.md](docs/TELEGRAM_PRODUCTION_HANDOFF.md)
- **Decisions:** [portable first release](docs/adr/0003-portable-render-first-release.md),
  [reviewed enrichment](docs/adr/0004-reviewed-enrichment-and-catalogue-authority.md)

## Run locally

Everything runs offline with stubs: seed JSON data, tag matching instead of AI, and a fake login. No keys needed.

**Backend** (Python 3.11):

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload          # http://localhost:8000/docs
pytest                                 # smoke tests
```

**Frontend** (Node 22.22+):

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev                            # http://localhost:5173
```

**Telegram bot** (test only): create a separate BotFather test bot and follow the [local Docker Compose and invite procedure](docs/TELEGRAM_TESTING.md). The public bot remains disabled until a separate release.

**Placeholder images:** `python data/scripts/make_placeholders.py` regenerates the `stub-*` images in `data/images/` from `data/seed/artworks.json`.

**Real artwork data** (how it is stored and why: [docs/adr/0001-artwork-data-storage.md](docs/adr/0001-artwork-data-storage.md)):

```bash
python3 data/scripts/import_profiles.py                     # AI profiles -> data/seed/artworks.json
backend/.venv/bin/python data/scripts/process_images.py     # download + resize images -> data/images/
```

Both are safe to re-run. Only artworks with `review_status: "approved"` are shown; put `INCLUDE_UNREVIEWED=true` in `backend/.env` to also see `pending` ones while developing. To approve a painting, set `review.status` to `"approved"` in `data/artworks_meme_descriptions.json` and run the import again.

## Repo layout

```
backend/    FastAPI: api/, services/, data/, ai/, render/, bot/   (Render)
frontend/   React + Vite + Tailwind + react-konva                 (Render Static Site target)
data/       seed JSON, placeholder images, schema.sql, import scripts
docs/       plan, design, API contract, architecture
```

## Working rules

Short-lived feature branches, PR into `main` at least once a day. CI runs backend tests and the frontend build. Every merge to `main` auto-deploys.

The deployment target is a Dockerized API plus static frontend on Render.
Both [Dockerfiles](docs/DEPLOYMENT.md#local-container-check) and the Blueprint are
prepared; no cloud resources have been created. Render auto-deploys are configured
to wait for passing CI. Public builds disable accounts/saving; PNG download stays
available. Telegram stays off until verified. See the [launch steps](docs/DEPLOYMENT.md#first-cloud-deployment).
