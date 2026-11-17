# Render deployment readiness and TBD map

Updated on 2026-11-17 against upstream `main` revision `c1f7e57`.
The agreed direction is recorded in [ADR 0003](adr/0003-portable-render-first-release.md);
this document tracks the work still required, not a deployed or production-ready system.
Dockerfiles, release safeguards and the Render Blueprint are prepared locally.
No hosting resources have been created; deployment still requires owner approval.
Existing task numbers refer to [the hackathon plan](Hachaton_plan.md).
Provider pricing and platform constraints are recorded separately in
[Render research](RENDER_RESEARCH.md), with official sources.

## Agreed first deployment

Keep the existing modular monolith. Host the Vite frontend as a **Render Static Site**,
run **one Dockerized FastAPI web service**, and keep
**Supabase Postgres, Auth and Storage** as already accepted in
[ADR 0001](adr/0001-artwork-data-storage.md). Prepare a frontend Dockerfile as well,
but do not pay for a frontend container service initially. Prepare Telegram
configuration for the same backend; leave the bot off unless it passes a deployment
smoke check without requiring bot feature work.

```text
Browser ----> Render Static Site (React/Vite)
Browser ----> Supabase Storage (images); Auth when user login is later enabled
Browser ----> Render Web Service (FastAPI container) <---- Telegram, only if ready
                 +----> Supabase REST/Postgres + Storage
                 +----> external AI provider
```

The diagram describes service boundaries, not additional services to buy. The browser
downloads images directly from Storage rather than routing them through FastAPI.
If enabled, the bot fetches images through the backend to render/send its own PNGs.
Use one Uvicorn worker initially; measure memory and latency before adding workers.
Do not add Redis, a queue, a separate bot server, a separate vector database, a Render
database, or a persistent disk for the first iteration.

This replaces the older Vercel frontend target. Dockerfiles, environment-driven
configuration and disposable application disks make a hosting change easier, but
Supabase Auth/Storage and embedding models still require explicit migration work.
See the [current/future data-store map](DATA_MODEL.md).

**Release scope:** public browsing and existing matching/editor flows, with own or
prewritten captions. Defer Google user login, generated captions, hybrid reranking,
rate limiting, circuit breakers, privacy redesign and the admin/enrichment UI.
Any internal endpoint must nevertheless have server-side admin authorization before
exposure. Do not expose fake-auth personal saving as a real account feature;
keep it unavailable until proper user auth is ready. These are implementation
requirements. Account disabling and startup/readiness checks are now implemented;
live provider/content verification remains required.

## Preparation checkpoint

- Both non-root application containers build on Linux ARM64 and Linux AMD64.
  The frontend image is an alternative; Render initially builds a free Static Site.
- **22 backend tests pass** inside the AMD64 API image; the frontend image build runs TypeScript
  checking and Vite. CI also builds both containers and runs an offline smoke check.
- Offline container checks pass for readiness, content/images, phrase matching,
  disabled account operations, configurable ports, SPA deep links and asset caching.
  The API used approximately **185 MiB under a 512 MiB / 0.5 CPU limit** in the
  AMD64 smoke check on an emulated local runtime. This is not a live-AI load test.
- `AUTH_MODE=disabled` rejects account operations even with fabricated bearer tokens.
  `VITE_AUTH_MODE=disabled` hides account controls/routes without blocking PNG export.
- `/api/health` is liveness/configuration; Render probes `/api/ready`. Startup checks
  required configuration, a nonempty visible catalogue and, in live matching mode,
  configured vector dimensions and situation-vector coverage for visible artworks.
  These checks do not call Gemini, verify image URLs or continuously probe Supabase.
- Render CLI access and paid Blueprint validation pass after the owner added
  billing. Validation reports the intended two services; it does not provision them.
  No paid resources were created.

### Local container check

Run from the repository root with Docker running:

```bash
docker build -f backend/Dockerfile -t pidsklom-api:check .
docker build -f frontend/Dockerfile -t pidsklom-web:check .
python3 scripts/check_containers.py
docker run --rm \
  --mount type=bind,src="$PWD/backend/tests",dst=/tmp/tests,readonly \
  -e PYTHONPATH=/app/backend pidsklom-api:check \
  pytest -q -p no:cacheprovider /tmp/tests
```

The smoke check starts temporary containers, publishes random loopback-only ports,
uses offline seed/stub data and disables accounts, then stops/removes its containers.
It does not load local `.env` files or contact live application providers.
Add `--platform linux/amd64` to each build to target Render from an ARM Mac.
The images use repository-root build context with an allowlist `.dockerignore`;
secrets, developer caches, docs and internal/session artifacts are excluded.

For alternative frontend container hosting, set the public API at **build** time:
`docker build -f frontend/Dockerfile --build-arg VITE_API_URL=https://<api-host> -t pidsklom-web:check .`.
Its runtime defaults to port 8080 and accepts `PORT`; the API defaults to 8000 and
also accepts `PORT`. The frontend container deliberately builds with accounts off.

### First cloud deployment

1. Owner: approve publishing the intended application/deployment docs and code,
   connect this GitHub repository to Render, add billing, and approve the selected
   paid instance/region. The Blueprint selects the 0.5 CPU / 512 MB compute plan
   (`0.5c-512mb`); confirm its price before applying. Set a region near Supabase
   before creation; omission currently uses Render's default region.
2. Verify the existing Supabase project, schema and public image buckets. Back up
   before applying SQL: `data/schema.sql` includes destructive legacy-vector changes.
   Review importer dry runs, upload approved content and generate/upload compatible
   embeddings separately from web startup. Never rerun imports automatically on deploy.
3. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `AI_API_KEY` privately in Render.
   Keep `AUTH_MODE=disabled`, `INCLUDE_UNREVIEWED=false`, `MATCH_MODE=embeddings` and
   `EMBEDDING_DIM=768`. Leave `TELEGRAM_BOT_TOKEN` unset. Do not send secrets in chat
   or place service-role credentials in frontend variables.
4. Validate with `render blueprints validate render.yaml --output json`, then apply
   the Blueprint from the approved `main` revision. Confirm actual service URLs:
   set API `PUBLIC_BASE_URL` and exact `FRONTEND_ORIGINS` accordingly. The Static Site
   reads its build-time `VITE_API_URL` from the API's `PUBLIC_BASE_URL`; rebuild it
   after URL changes. Both services wait for passing CI on future auto-deploys;
   initial/manual deploys still need an explicit check of the selected commit.
5. Verify `/api/ready`, approved artists/artworks and image URLs; exercise a new
   phrase and confirm `source=embeddings`, then provider-failure fallback in a
   controlled check. In a browser, reload a nested route, edit a caption, download
   a PNG and confirm accounts/saving are unavailable. Verify CORS accepts only the
   chosen frontend origin and data/images remain available after an API redeploy.
6. Record the working revision/environment and rehearse rollback to a known-safe
   release. Render application rollback does not revert SQL, imports or credentials.
   Do not roll back past the public fake-auth protections while exposing the site.
   Recheck auto-deploy settings after dashboard rollback and repeat readiness,
   matching and browser checks. Telegram remains a separate go/no-go check.

## Budget: approximately $25/month target

**Render Hobby is the workspace plan, not the server instance.** You can keep Hobby
and pay for one always-on server; upgrading the workspace alone does not warm a
Free instance. Published prices below are USD/month before overages and AI fees;
see [the cited research](RENDER_RESEARCH.md) for provider sources and uncertainties.

| Option | Services | Base monthly cost | Trade-off |
| --- | --- | --- | --- |
| Connectivity experiment | Hobby + static site + Free API + Supabase Free | $0 | API sleeps after 15 idle minutes; unsuitable for predictable demo/bot latency |
| Recommended hackathon baseline | Hobby + static site + Starter API (512 MB, 0.5 CPU) + Supabase Free | About $7 | API stays running, but database pause/recovery limitations remain; measure Pillow memory before committing |
| Database availability/recovery upgrade | Same Render setup + one Supabase Pro Micro project | About $32 | Paid database avoids inactivity pause and adds daily database backups; Storage files still need their own backup |

Important budget constraints:

- Hobby currently allows **one workspace member**. The four-person team can still
  collaborate through GitHub, but direct shared Render administration needs an
  appropriate workspace upgrade; do not share an account. Render Pro is $25/month
  plus compute, so workspace Pro plus Starter API is about $32 before Supabase/AI.
- Hobby includes **5 GB bandwidth and 500 build minutes/month**. Published overages
  are $0.15/GB and $5 per 1,000 Starter pipeline minutes. Set the pipeline spend
  limit and monitor bandwidth; a general hard bandwidth spend cap was not verified.
- Supabase Free includes **500 MB database and 1 GB files**, with **5 GB uncached
  plus 5 GB cached egress**. These are separate from Render usage. For scale intuition,
  1 GB holds only roughly 1,000 one-megabyte PNGs before other assets; measure actual
  exported PNG sizes and define retention.
- Paid compute is usage-prorated, so paying for demo preparation/presentation days
  is an option, but downgrading later restores cold starts. Warming with synthetic
  pings is not a reliability strategy.
- The agreed planning target is approximately **$25/month**, not a hard billing
  cap. Start at about $7 base hosting, leaving headroom rather than immediately
  buying the $25 instance. AI, overages and optional services still count toward
  actual spend. Both the $32 database upgrade and a paid Render workspace exceed
  this target before additional costs; neither is selected.
- Staying below 500 MB of database data does not prevent inactivity pausing or
  image/egress quota exhaustion. Supabase Free remains the agreed baseline.

## What actually exists

| Area | Observed implementation | Deployment implication |
| --- | --- | --- |
| Hosting | [`render.yaml`](../render.yaml) declares a paid Docker API and free Static Site; both applications have Dockerfiles | Builds and paid Blueprint validation pass; no resources exist |
| Data | [`SupabaseRepository`](../backend/app/data/supabase_repo.py) is implemented, despite stale TODO comments elsewhere | Wire it up and verify it; do not schedule a rewrite |
| Content delivery | Startup loads the cached catalogue and configured live vectors before readiness | Content updates need an explicit restart; readiness is not continuous dependency monitoring |
| Persistence | Local mode writes memes under `backend/media`; Supabase mode uploads PNGs and writes database rows | Use Supabase for any deployment promising saved data |
| Login/admin | Public deployment disables accounts in backend/frontend; future JWT support is still legacy HS256; no admin authorization/internal route exists | Google login remains deferred; future internal routes need real admin authorization |
| Matching | [`LLMProvider`](../backend/app/ai/llm.py) now embeds queries through Gemini and searches [`EmbeddingIndex`](../backend/app/ai/matching.py); `source` can be `embeddings` | Load compatible durable vectors and verify this path, not reimplement it |
| Captions/hybrid | `captions()` is unimplemented; hybrid mode logs a warning and uses embedding ranking | Prewritten captions and embedding-only matching are the first-release scope |
| Vectors | [`artwork_embeddings`](../data/schema.sql) stores multiple `vector(768)` rows per artwork; the new embedding script populates them | Apply the schema change and upload vectors before enabling live matching |
| Abuse controls | [`BLOCKLIST`](../backend/app/ai/moderation.py) is empty; rate limiting is still a TODO; no circuit breaker exists | Throttling/circuit breakers explicitly deferred; existing fallback does not enforce a budget |
| Telegram | Webhook is registered during lifespan startup and each update is handled before returning HTTP success | Requires deployment/retry testing; not a separate paid worker |
| CI | [Workflow](../.github/workflows/ci.yml) runs backend tests, frontend build and container smoke checks | Offline tests do not establish live integration readiness |

### Verified local baseline

- Backend after merging `c1f7e57`: **9 tests passed**, Python 3.11.14, including
  synthetic vector-scoring rules. Dependencies include the new NumPy requirement.
  This was the pre-container baseline; current container checks are described above.
- Frontend after merging `c1f7e57`: `npm run build` passed, including TypeScript
  checking, using the previously restored lockfile dependencies.
  The local Node 22.21.1 is below `react-router`'s declared `>=22.22.0` requirement;
  select a compatible supported Node version for Render and local development.
  Vite also reports a roughly 709 kB minified JavaScript chunk; code splitting is a
  follow-up performance task, not a reason to block the first deployment.
- Content-import dry run from the earlier assessment passed without uploading;
  that script and seed content are unchanged by this merge.
  Default import selects **1 artist, 15 artworks, 1 fact, 30 image files**.
  Of those artworks, **13 are approved and 2 rejected**; repository filtering hides
  rejected rows. The seed contains 22 artworks total, including placeholders.
  Do not mistake passing local smoke tests for a complete real-content catalogue.

The new embedding-script dry run passed: **108 texts for 13 artworks**, all
requiring embedding in this clean validation environment. It checks counts only;
no live embeddings were generated.
The original assessment did not exercise external services. Container builds and
offline smoke checks now pass; live Supabase, Gemini, Telegram and browser flows
remain unverified. Render CLI workspace access is verified.

## Prioritized deployment backlog

IDs below are local planning references, not GitHub issues. Owners are suggested
using the plan's A/B/C/D roles. Acceptance checks are the definition of done.

| ID / priority | TBD and concrete change | Acceptance check | Owner / dependency |
| --- | --- | --- | --- |
| DEP-01 / locally prepared | Both Dockerfiles, minimal build contexts and Docker/static Blueprint are implemented. Provision and verify on Render after owner approval/billing. | Local builds and container deep links pass; Render-hosted routes, pricing and region still need verification. | D + B; T02/T03 |
| DEP-02 / first deploy | Configure Supabase schema/buckets, import reviewed content and apply the new embedding-table migration. Generate/upload compatible 768-dimensional vectors if enabling live matching. Keep disk disposable. | Real approved content/images survive API redeploy; matching returns `source=embeddings` with the configured model/dimension or clearly marked fallback. No claim that saved-account flows are released. | A + D; T04/T11, DEP-01 |
| DEP-03 / later user-account release | Complete Google auth/session restoration and JWT verification against the actual signing keys. Decide the later generation/login gate explicitly. Until then, keep personal saving unavailable and prevent public fake-auth mutations. | Public release cannot save using a fabricated development identity. Later login, refresh, logout, invalid-token and cross-user ownership tests pass before saving is enabled. | A + B; T22, DEP-02; public feature gating before launch |
| DEP-04 / locally prepared | Exact-origin CORS and disabled account UI are implemented. Set actual deployed URLs; the Static Site gets build-time API URL from API configuration. | Local CORS rejection passes; live browser requests and canvas PNG export still need verification. | B + D; DEP-01 |
| DEP-05 / deferred | Add web/bot rate limiting, spend enforcement and circuit breakers in a later release. This is not a first-release prerequisite by decision. | Future tests prove limits, explicit errors and recovery behavior. Until then, document quota exhaustion/fallback and do not assume spending is capped. | A + D; T21 |
| DEP-06 / first deploy; extensions later | Verify the merged Gemini embedding path and existing timeout/fallback. Keep `MATCH_MODE=embeddings`; do not enable unfinished hybrid/caption generation. | Live matching uses uploaded vectors; provider failure returns marked fallback. Own/prewritten captions remain usable without a caption-generation call. | A; T05/T13, DEP-02 |
| DEP-07 / optional bot infrastructure | Prepare token/secret/public URL configuration and a bot-disabled default in the same API deployment. Test the existing bot only if it is ready; do not make bot feature work a website-launch dependency. | If existing bot returns a PNG/story under a deployment/restart smoke check, enable it. Otherwise leave token unset and record failure; website still launches. | D; T07/T19, DEP-01/02/06 |
| DEP-08 / locally prepared | Startup validates configuration, nonempty catalogue, vector dimensions and visible-artwork situation coverage; Render probes cheap `/api/ready`, separate from liveness. | Synthetic startup rejection/ready tests pass; live content/image checks and zero-downtime replacement remain to verify on Render. | A + D; DEP-02 |
| DEP-09 / capacity follow-up | Bound `_match_cache`, the new `_query_cache`, and optional bot `_pending`; define snapshot refresh and avoid blocking async requests with vector loads/Pillow. Start with one worker and observe actual memory. | A small initial-instance smoke/load check is acceptable; if not, fix blocking/memory problems before enabling the affected path. This task is not a rate limiter or circuit breaker. | A + D; DEP-02/06; DEP-07 only if bot enabled |
| DEP-10 / locally prepared | Blueprint uses `checksPass` and build filters; CI builds/smokes both containers. Deployed matching/browser checks and rollback rehearsal remain. | Verify CI gating against the selected branch after provisioning; rehearse safe rollback separately from schema recovery. | D + A/B; DEP-01; matching smoke after DEP-02 |
| DEP-11 / later saved-data release | Preserve current public-by-link behavior without a privacy redesign. Add PNG-size alignment, Storage cleanup, backup/restore and retention before valuable user data is accepted. | No false privacy promise; later save/delete failure paths and database plus Storage restoration are verified. | A + D; DEP-02/03 |
| DEP-12 / demo readiness | Curate real artist/artwork stories, verified facts and fallback captions; update stale Vercel/Supabase/AI TODO documentation and plan statuses after integration verification. | Demo flows use approved real images and reviewed stories, not placeholders or missing facts; team can follow one current runbook. | C + A/D; T10/T23 |
| DEP-13 / any internal endpoint | Inventory internal/admin routes before deployment. None currently exist; enforce trusted server-side admin authorization before exposing one. The admin UI/workflow can stay deferred. | Anonymous callers and ordinary signed-in users cannot invoke internal mutations; hiding a UI control is not authorization. | A + D; prerequisite whenever an internal route is added |

Important details behind these tasks:

- **Docker build context:** [`config.py`](../backend/app/config.py) resolves `data/`
  next to `backend/`; local mode mounts those images and local semantic matching
  expects a generated vector cache. Use repository-root context for the backend
  Dockerfile, copy only required application/data/font files, install NumPy/Pillow
  in the image and run non-root. Keep `.env`, keys, generated media/vector caches,
  dependency directories and session/internal artifacts out of build contexts.
  Bind `$PORT` on all interfaces with correct signal forwarding. Test without
  host bind mounts; a developer's untracked cache must not mask a missing image asset.
  Include `data/**` in relevant deploy filters.
- **Frontend portability:** use a build stage and a small static-serving runtime
  image with SPA fallback; inject only public `VITE_*` values at build time.
  Render initially uses the same source/build settings for its free Static Site
  instead of running this image. Maintain and test both routes.
- **Do not carry stale TODOs forward:** `SupabaseRepository` and the uploader already
  exist. The merged `LLMProvider` also implements embedding matching now, despite
  its name. `MATCH_MODE=hybrid` still does not implement hybrid reranking.
- **Vector migration/import:** `schema.sql` drops the old single vector column
  and `match_artworks()` function and adds `artwork_embeddings`. Back up first.
  The new embedding uploader replaces model/dimension rows in multiple requests,
  not atomically; schedule it outside a live demo and verify completeness.
  Large requested REST `limit` values do not override the project's row cap;
  verify pagination/completeness before increasing the catalogue.
- **Bot go/no-go:** [`webhook.py`](../backend/app/bot/webhook.py) currently sets
  `drop_pending_updates=True` on startup and processes updates before acknowledging
  them. Bot callback state is process-local. These deserve explicit restart/retry
  checks; if they require technical bot changes beyond the agreed scope, defer bot
  deployment rather than silently accepting message loss.
- **Upload contract mismatch:** [`api/memes.py`](../backend/app/api/memes.py) accepts
  an approximately 6 MB PNG via an 8 MiB data URL, but
  [`schema.sql`](../data/schema.sql) caps the bucket file size at 5 MiB. Align
  application validation, decoded size and Storage limits; return a useful error.
  Base64 also increases transfer and memory use. Direct signed uploads can wait.
- **Storage consistency:** PNG upload precedes row insertion, and deletion currently
  ignores the Storage response in `SupabaseRepository.delete_meme`. Plan compensation
  or retryable cleanup so failed saves/deletes do not consume storage indefinitely.
- **Liveness is not readiness.** `/api/health` reports switches; Render uses
  `/api/ready` after startup loads content/vectors. Readiness does not call Gemini,
  check all image URLs or continuously monitor external dependencies.
- **A paid always-on API does not prevent a free Supabase project from pausing.**
  Check/resume it before a demo; choose a paid database plan if continuous operation
  and stronger recovery guarantees become requirements.

## Configuration map

Set concrete URLs only after service names/regions are chosen. Never copy real secrets
into this document or into the repository.

| Where | Variables / settings | Notes |
| --- | --- | --- |
| Static site, build-time | `VITE_API_URL=https://<api>.onrender.com`, `VITE_AUTH_MODE=disabled` | Changes require rebuilding. Fake browser login is dev-only; keep production accounts disabled. Never expose service/AI/bot credentials through `VITE_*`. |
| API, runtime | `ENVIRONMENT=production`, `DATA_BACKEND=supabase`, `INCLUDE_UNREVIEWED=false`, `AUTH_MODE=disabled` | Production rejects local data, fake auth and unreviewed content; account operations return `403`. Google login remains deferred. |
| API, runtime | `PUBLIC_BASE_URL=https://<api>.onrender.com`, `FRONTEND_ORIGINS=https://<site>.onrender.com` | Exact origins; no paths or trailing slash in CORS origins. |
| API, secrets | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`; JWT config when real auth is enabled | Current JWT code only supports legacy HS256. Verify service-key header compatibility with the actual Supabase key type. Never use a service key as an admin-browser credential. |
| API, matching | `AI_PROVIDER=llm`, `AI_API_KEY`, `MATCH_MODE=embeddings`, `EMBEDDING_MODEL`, `EMBEDDING_DIM=768`, `EMBEDDING_TIMEOUT_S`, `AI_TIMEOUT_S` | Gemini embeddings are implemented. Model/dimension must match uploaded vectors and the fixed schema dimension. `AI_PROVIDER=stub` is an explicit fallback-only deployment option. |
| API, later hybrid | `AI_MODEL` and ranking settings in `config.py` | Hybrid reranking/generated captions remain unfinished; do not make a working LLM model a first-release dependency. |
| API, bot | `TELEGRAM_BOT_TOKEN`, generated `TELEGRAM_WEBHOOK_SECRET` | Keep bot off until its webhook and error paths have been verified. |
| Internal endpoints, when introduced | Trusted admin identity/role configuration, exact mechanism to be chosen with implementation | Server-side authorization is mandatory; user-controlled profile fields and a visible login alone do not establish admin rights. |
| Supabase / Google, later | Site URL, redirect allowlist and Google OAuth settings | Deferred user-login implementation must configure these before enabling saved-account flows. |
| Render | Docker API with repository-root build context; static frontend with `rootDir: frontend`, build `npm ci && npm run build`, publish `dist`, rewrite `/*` to `/index.html` | Frontend Dockerfile is a portable alternative, not a second paid service. `frontend/vercel.json` does not configure Render. |

Keep schema/data import separate from ordinary web service startup. Use the existing
manual SQL/import steps for this iteration, recording what was applied. Do not
replay destructive schema changes or content imports on each container boot.
Introduce versioned migrations before schema changes have multiple deployed consumers.
Choose nearby supported Render/Supabase regions to reduce round-trip time.

## Iterations and release gates

1. **Portable deployment skeleton:** DEP-01/04/10; build both Docker alternatives,
   deploy API container plus free static frontend, verify health/deep links/CORS
   and catalogue connectivity. No bot or working account feature required.
2. **Simple public release:** DEP-02/06/08/12, public fake-saving protection from
   DEP-03, and DEP-13 whenever any internal endpoint exists. Check memory/latency
   on the initial instance; address DEP-09 if the selected path is not viable.
   Rehearse phrase matching, own/prewritten caption editing, PNG download,
   provider fallback, content persistence across redeploy and rollback.
3. **Optional bot enablement:** DEP-07 only if the existing implementation passes.
   Otherwise keep it disabled without delaying the website. User Google login,
   rate limits/circuit breakers and admin enrichment belong to later iterations.

Container/static frontend work and Supabase setup can proceed in parallel.
Infrastructure support is not evidence that the bot is functionally ready.
Before a demo, verify free Supabase availability and complete vectors; a process
health response does not prove either.

## Scalability without premature infrastructure

Start with one instance, small content/vector snapshots, external durable storage
and browser-side PNG export. Request rate limiting is deferred; measure concurrency
and memory rather than claiming the initial deployment enforces a quota.
Track request count, p95 latency, error/fallback rate, RSS/CPU, render duration,
AI tokens/spend, Storage usage and egress. Do not log tokens or sensitive webhook URLs.

| Trigger | Next change, only when needed |
| --- | --- |
| Single instance exceeds memory/latency goals after bounded caches and rendering work | Tune concurrency and move to a larger instance; load-test before buying capacity. |
| Bot rendering or long AI work crowds out interactive requests | Separate bounded processing; add a durable queue/worker only when accepted work needs to survive restarts. An in-process task is not a durable queue. |
| More than one process/replica is needed | Externalize `/random` callback state, shared quotas and any required deduplication; make cache invalidation/versioning explicit. Process-local caches may remain optional accelerators. Confirm Render plan eligibility first. |
| Catalogue/search actually becomes slow | Paginate catalogue/vector reads and later personal meme lists; move filtering/search into Postgres. Current `_select(limit=5000)` and vector `limit=100000` do not guarantee complete reads beyond the project's row cap. |
| Image traffic/storage dominates cost | Measure average object size and downloads, optimize thumbnails/PNG output and retention; consider direct signed uploads without making private files public. |
| User data becomes valuable | Upgrade recovery/backup capability before scaling traffic; seeds reconstruct content, not user accounts, saved meme rows or uploaded PNGs. |

Horizontal scale is not the first optimization. The current bot callback dictionary,
unbounded matching/query caches and CPU rendering deserve
attention before buying more replicas.

## Future admin workflow

[ADR 0004](adr/0004-reviewed-enrichment-and-catalogue-authority.md) records the
accepted direction: an admin resolves artist identity, staged enrichment prepares
draft material, and a human checks it before publication. Multi-agent orchestration
is optional; no admin UI, job tables or workflow engine is implemented or selected.

Today seeds are authoritative for the manual content pipeline. When admin ingestion
ships, Postgres becomes authoritative and seeds become bootstrap/export snapshots;
a deploy must not overwrite live admin edits. The [data map](DATA_MODEL.md) covers
the current tables, images, vectors and that future cutover.

The exact admin identity mechanism and future workflow schema/runner remain
unselected. Containers, account gates and the Blueprint are now prepared locally;
cloud provisioning and live deployment have not been performed.
