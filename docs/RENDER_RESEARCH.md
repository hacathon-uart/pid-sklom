# Render + Supabase deployment research (budget hackathon app)

Verified against official pages on **2026-11-17**. Only render.com and supabase.com primary sources used. "Unknown" = not found on an official page; no numbers invented.

This is provider research, not the current release scope. Agreed budget, Docker
portability, optional bot and deferred account/abuse-control work are recorded in
[ADR 0003](adr/0003-portable-render-first-release.md) and the [deployment map](DEPLOYMENT.md).

## Conclusions

1. **Hobby workspace = $0/month platform fee; you pay only for per-service compute** (+ usage overage). Source: [render.com/pricing](https://render.com/pricing) ("Hobby … $0 /mo + compute"); [docs/platform-features-by-plan](https://render.com/docs/platform-features-by-plan) ("The Hobby plan does not have a monthly fee").
2. **Cheapest paid always-on web service: Starter / `0.5c-512mb` = $7/month, 0.5 CPU, 512 MB RAM** ([pricing](https://render.com/pricing) compute table; specs [docs/compute-plans](https://render.com/docs/compute-plans); legacy name `starter`). Next tier `1c-2g` (legacy `standard`) = $25/month, 1 CPU, 2 GB.
3. **Static site (React/Vite) = free**, on CDN, with SPA rewrite support ([docs/static-sites](https://render.com/docs/static-sites); [pricing](https://render.com/pricing): "Always free to deploy"). It still consumes the workspace's bandwidth and pipeline minutes.
4. **Recommendation**
   - **$0 experiment**: static site (free) + Free web service + Supabase Free. Works for a demo only; see caveats (≈1 min cold start after 15 min idle, which is hostile to a Telegram webhook; Supabase pauses after 1 week idle).
   - **Always-on API baseline, about $7/month**: static site ($0) + one Starter web service ($7) + Supabase Free ($0). This removes the API's idle spin-down, not all availability risks. Remaining risk: 512 MB RAM with Pillow (unknown if sufficient, test), and Supabase Free pause/no automatic backups. Check/resume the database before the demo and export user data plus Storage files separately; upgrade if continuous database availability is required.
   - Next step when real data/users matter: Supabase Pro ≥ $25/month (≈ $32 total with Render Starter). Hobby → Pro workspace ($25/month + compute) is only needed for autoscaling/team features.

## Render

### Workspace plan vs service cost
- Plans: Hobby $0, Pro $25, Scale $499 per month, each "+ compute" — [pricing](https://render.com/pricing).
- Hobby limits: single team member, 25 services, 2 environments per project — [platform-features-by-plan](https://render.com/docs/platform-features-by-plan).
- Upgrading the workspace does **not** remove Free-instance limitations; compute plan is per service — [docs/free](https://render.com/docs/free).
- Compute billed prorated to the second — [pricing](https://render.com/pricing) FAQ; [docs/scaling](https://render.com/docs/scaling#billing-for-scaled-services).
- Plan-ID rename on **2026-08-26** (e.g. `starter` → `0.5c-512mb`); no pricing change; legacy names still valid in Blueprints/API — [docs/compute-plans-update](https://render.com/docs/compute-plans-update). This is the only "transition" I found; it is already in effect.

### Free web service / free tier (for the $0 option)
Source: [docs/free](https://render.com/docs/free).
- Spins down after 15 min without inbound traffic; spin-up ≈ 1 minute.
- Ephemeral filesystem: local files lost on redeploy, restart, spin-down. No persistent disk on Free.
- 750 free instance hours per workspace per month; exceeded → Free services suspended until next month.
- Free services consume included bandwidth and pipeline minutes; exceeding bandwidth bills you (or suspends if no payment method).
- May suspend Free services that initiate "uncommonly high" outbound traffic (e.g., external DB, external APIs, object storage); fix = paid plan. Threshold is not published → unknown.
- Render may restart Free service at any time; no scaling beyond 1 instance; no SSH/shell, no one-off jobs.
- Outbound ports 25/465/587 blocked on Free (SMTP). Port 25 blocked for all services. Outbound HTTPS (Telegram Bot API, Supabase) is not listed as blocked.
- Rollbacks on Free only to the two most recent previous deploys.
- Render Free Postgres expires after 30 days (not relevant; Supabase is the DB).

### Static site hosting / SPA
- Global CDN, atomic zero-downtime deploys, immediate cache invalidation, managed TLS, custom headers, PR previews — [docs/static-sites](https://render.com/docs/static-sites).
- Custom domains: Hobby includes 2, then $0.25/domain/month — same page and [pricing](https://render.com/pricing).
- SPA fallback: add a **Rewrite** `/*` → `/index.html`; existing files are served first, rules don't override real resources — [docs/redirects-rewrites](https://render.com/docs/redirects-rewrites).
- Blueprint: `type: web` + `runtime: static`, `staticPublishPath` (required), `routes` (`type: rewrite`, `source`, `destination`), `headers` — [docs/blueprint-spec](https://render.com/docs/blueprint-spec). Publish dir and build command are relative to `rootDir` — [docs/monorepo-support](https://render.com/docs/monorepo-support#root-relative-settings). Typical Vite: build `npm ci && npm run build`, publish `dist` (my application of the docs, not an official snippet).

### Monorepo: rootDir and sibling data
Source: [docs/monorepo-support](https://render.com/docs/monorepo-support); [docs/blueprint-spec](https://render.com/docs/blueprint-spec).
- **"Files outside your service's root directory are not available to the service at build time or at runtime."** So a Python service with `rootDir: backend` **cannot read sibling `data/`**. Options: leave `rootDir` unset (repo root; use `cd backend && pip install -r requirements.txt` and start command from repo root so `data/` is reachable), or copy/move data inside `backend/`. This is a direct consequence of the doc; Docker build context follows the same root-relative rule.
- Build filters: `buildFilter.paths` / `ignoredPaths` (glob, **always relative to repo root**, can include other directories); ignored beats included. Setting both `rootDir` and filters is allowed. Blueprint file changes always sync; manual deploys ignore filters.
- Practical pattern: keep API at repo root with `buildFilter.paths: [backend/**, data/**]`; frontend static site `rootDir: frontend`.

### Blueprint fields (current schema, [blueprint-spec](https://render.com/docs/blueprint-spec))
- `autoDeployTrigger`: `commit` (default for new service) | `checksPass` (deploy only if branch CI checks pass — CI gating) | `off`. Replaces deprecated `autoDeploy`; no effect on prebuilt Docker image services.
- `healthCheckPath`: web services only, starts with `/`.
- `rootDir`, `buildFilter`, `plan`, `numInstances`, `scaling` (autoscale), `maxShutdownDelaySeconds` (1–300, default 30), `staticPublishPath`, `routes`, `headers`.
- Whether `checksPass` works with your CI (GitHub Actions) as the "checks" source: **unknown beyond doc wording "linked branch's CI checks pass"**; test it.

### Health checks
[docs/health-checks](https://render.com/docs/health-checks): default TCP probe on the open port (default 10000); optional HTTP GET path, 2xx/3xx healthy, 5 s timeout. New deploy goes live only when all new instances pass at the same time; otherwise cancelled after 15 min and old instances keep serving. Unhealthy running instances are restarted. Make the health endpoint cheap (don't call Pillow/Supabase on it) to avoid restart loops. Bind to `$PORT`/`0.0.0.0` (port-binding doc not fetched; free-tier doc mentions reserved ports 18012/18013/19099).

### Scaling
[docs/scaling](https://render.com/docs/scaling); [platform-features-by-plan](https://render.com/docs/platform-features-by-plan).
- Free: 1 instance only. Paid (≤8 CPU and ≤32 GB): up to 100 instances; otherwise 5.
- **Manual horizontal scaling is available on all workspaces including Hobby** (set instance count; billed per instance, e.g. 2 instances = 2× price).
- **Autoscaling requires Pro workspace** ($25/month) or higher.
- Vertical scaling = change compute plan (redeploy, zero downtime unless a persistent disk is attached).
- Services with a persistent disk cannot scale beyond 1 instance.
- Caveat for this app: Telegram webhook + in-process state is fine at 1 instance; multi-instance needs stateless handling (unverified here; app-specific).

### Bandwidth and build pipeline
- Included per month: Hobby 5 GB bandwidth, 500 pipeline minutes; Pro 25 GB / 1,000 min — [outbound-bandwidth](https://render.com/docs/outbound-bandwidth), [build-pipeline](https://render.com/docs/build-pipeline).
- Overage: **$0.15/GB** bandwidth; **$5 per 1,000 pipeline minutes** (Starter tier) — [outbound-bandwidth](https://render.com/docs/outbound-bandwidth), [pricing](https://render.com/pricing).
- No payment method + exceeding bandwidth → services spun down/suspended until next month. No payment method or spend limit reached → **builds stop** (running services stay live with existing artifacts).
- **Pipeline spend limit** can be set in Workspace Settings; there is **no documented bandwidth spend cap** (only no-payment-method suspension) → treat as unknown/none. Egress counts HTTP responses, WebSocket, and service-initiated public traffic (Supabase calls, Telegram API, image responses) — [outbound-bandwidth](https://render.com/docs/outbound-bandwidth). Generated Pillow images served from the API count; serve images via Supabase Storage/CDN or keep them small to protect the 5 GB.
- Hobby builds use Starter tier: 2 CPU / 8 GB RAM, build disk limit 16 GB, build timeout 120 min.
- I found **no announced future effective-date changes** to these Render prices/limits on the official pages.

### Deploys and rollback
[docs/rollbacks](https://render.com/docs/rollbacks): rollback reuses a retained build artifact (fast); Dashboard rollback **disables autodeploy** (re-enable in Settings), API rollback does not. Env vars/start command/health path/instance count match the target deploy; compute plan, custom domains, static rewrites/headers do not roll back. Retention depends on plan: Hobby retains **5 builds** per [pricing](https://render.com/pricing) ("Instant rollbacks 5 builds retained"; applying to Hobby column is my reading of the table).

### Outbound / webhooks
- Telegram webhook is **inbound** HTTPS to the web service; Render terminates TLS ([static-sites](https://render.com/docs/static-sites) and docs list managed TLS for every site/service). Cold start (Free) ≈ 1 min could make Telegram retries/timeouts; paid always-on avoids this ([docs/free](https://render.com/docs/free#spinning-down-on-idle)). Telegram retry behavior is not covered here (not a Render/Supabase source).
- Outbound SMTP ports blocked on Free; port 25 on all.

## Supabase (current pricing: [supabase.com/pricing](https://supabase.com/pricing); [billing docs](https://supabase.com/docs/guides/platform/billing-on-supabase))
| Item | Free | Pro ($25/mo base) |
|---|---|---|
| Projects | 2 active | per-project compute |
| DB size | 500 MB/project (Shared CPU, 500 MB RAM) | 8 GB/project, then $0.125/GB |
| File storage | 1 GB | 100 GB, then ~$0.021/GB |
| Egress | 5 GB (+5 GB cached) | 250 GB, then $0.09/GB |
| MAU | 50,000 | 100,000, then $0.00325 |
| Backups | **None** | Daily, 7 days; PITR add-on $100/mo per 7 days |
| Pausing | After 1 week inactivity | Never |

- Pro includes $10/month compute credit covering one Micro (1 GB RAM) instance; extra projects add their own compute — [pricing](https://supabase.com/pricing). A single Micro project on Pro = $25/month before overages.
- **Pause**: Free projects with insufficient DB activity over 7 days are paused; warning email ~1 week before; "a few user requests to the database each day" typically suffices; restore from dashboard within **1 year**; paused projects don't count toward the 2-project limit — [free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing); [billing](https://supabase.com/docs/guides/platform/billing-on-supabase).
- **Backups**: automatic daily backups only on Pro/Team/Enterprise; docs recommend Free users export with `supabase db dump` and keep off-site copies; **Storage objects are not in DB backups** — [backups](https://supabase.com/docs/guides/platform/backups).
- Free-tier overage behavior (hard-stop vs. restrict) not verified in the pages read → unknown; Pro has a spend-cap/cost-control page ([cost-control](https://supabase.com/docs/guides/platform/cost-control), not fetched).
- Egress note: Supabase egress (Free 5 GB) is counted separately from Render egress (Hobby 5 GB); an image served API→user counts on Render; Storage→user counts on Supabase.
- **JWT**: Supabase issues JWTs; `iss` + `/.well-known/jwks.json` exposes public keys; new **JWT Signing Keys** (asymmetric RSA/EC or shared secret) are the recommended system, legacy JWT secret "No longer recommended"; use `supabase.auth.getClaims()` or a standard JWT library rather than hand-rolled verification — [auth/jwts](https://supabase.com/docs/guides/auth/jwts); [auth/signing-keys](https://supabase.com/docs/guides/auth/signing-keys). Python/FastAPI-specific verification recipe: not fetched (unknown).

## Cost summary (monthly, from verified numbers)
| Setup | Render | Supabase | Total |
|---|---|---|---|
| $0 experiment | Hobby $0, static $0, Free web $0 | Free $0 | **$0** (sleeps, no backups, pauses) |
| Always-on API baseline | Hobby $0, static $0, Starter $7 | Free $0 | **$7** + any overage |
| With DB safety | same $7 | Pro $25 | **~$32** |

## Cost caveats
- AI/image traffic: egress overage $0.15/GB on Render beyond 5 GB. Example arithmetic: 10 GB extra ≈ $1.50. Pipeline overage only $5 per 1,000 min, but with no payment method builds just stop.
- Payment method required for overage billing; without it, bandwidth overflow suspends services (Hobby 5 GB). Adding a card removes the safety stop and there is no documented bandwidth cap → monitor the Billing page; set a pipeline spend limit.
- Third-party AI API fees (if "AI" means an LLM/image provider) are outside both sources → unknown.
- 512 MB RAM adequacy for Pillow + FastAPI + aiogram is not stated by Render; test, fallback `1c-2g` at $25.

## Gaps
- Render pricing page is JS-heavy; numbers come from its server-rendered HTML (cross-checked against docs for specs/included amounts).
- Not verified: Render `autoDeployTrigger: checksPass` provider behavior; Render port-binding doc; Supabase Free overage policy; Supabase cost-control details; no future-dated changes found on any fetched page.
