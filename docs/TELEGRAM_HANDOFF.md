# Telegram bot implementation handoff

Historical starting snapshot for the bot work. See
[TELEGRAM_IMPLEMENTATION_PLAN.md](TELEGRAM_IMPLEMENTATION_PLAN.md) and
[TELEGRAM_TESTING.md](TELEGRAM_TESTING.md) for the implemented test release and
remaining live acceptance.

## Mission and starting point

Finish and verify the existing aiogram bot, reusing the website's creation
services. Do not start a parallel matching engine or rebuild the working website.
The bot is scaffolded, not production-ready.

Prepared against clean `main` at
`fc9da08409db811af724eba2445ac3a2f9f6e262` (PR #16).
Fetch and inspect the current branch before implementation; this is a snapshot,
not an instruction to reset the checkout.

Last verified release state:

- Website: https://pidsklom-web-bhw6.onrender.com
- API: https://pidsklom-api-bhw6.onrender.com
- Frontend runs the revision above. API runs
  `7446e79425c24a5deac78b359768f56b273a3363`; backend files were unchanged by #16.
- Real Supabase catalogue, Auth and Storage; Gemini matching/captions.
  Google sign-in and both browser guest allowances are enabled.
- Telegram remains disabled and unverified. Recheck live configuration privately
  before any rollout; do not infer readiness from the existence of handlers.

**This handoff does not authorize implementation decisions, production
enablement, a merge, new paid resources or database changes.**

## Read first

1. [`../CONTEXT.md`](../CONTEXT.md): domain language and allowance semantics.
2. [`AUTHENTICATION.md`](AUTHENTICATION.md) and
   [ADR 0006](adr/0006-google-identity-and-guest-allowance.md) /
   [ADR 0007](adr/0007-distinct-guest-png-exports.md): current identity/accounting.
3. [`DEPLOYMENT.md`](DEPLOYMENT.md) and
   [ADR 0003](adr/0003-portable-render-first-release.md): release constraints.
4. [`Hachaton_plan.md`](Hachaton_plan.md): original US-12, US-18 and
   T07/T16/T19/T26 requirements. Its base64 design images are large; read targeted
   sections rather than the whole file.
5. [`DATA_MODEL.md`](DATA_MODEL.md), [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md),
   then the code map below.

**Documentation drift:** README, ARCHITECTURE, API and older DEPLOYMENT checkpoints
still contain initial-release statements that accounts are disabled, Google login
is deferred, or Render has not been provisioned. Those are historical/stale, not
instructions to disable working production features. API.md also omits newer
guest/export contracts; inspect actual routes and schemas. Correct bot-relevant
claims as part of the bot change without a broad documentation rewrite.

## Existing implementation

| File | Current responsibility |
|---|---|
| `backend/app/bot/handlers.py` | `/start`, text phrase -> rendered image + story, `/random` -> three inline caption buttons |
| `backend/app/bot/webhook.py` | Cached Bot/Dispatcher, webhook registration, secret-path FastAPI route |
| `backend/app/bot/polling.py` | Local polling; deletes the configured bot's webhook and drops pending updates |
| `backend/app/services/create.py` | Shared matching/caption orchestration, moderation, AI timeout/fallback and match cache |
| `backend/app/ai/llm.py` | Gemini embeddings + NumPy ranking; generated captions; query cache |
| `backend/app/data/` | Local/Supabase repository adapters and reviewed catalogue |
| `backend/app/render/meme.py` | Pillow rendering, image fetching, PNG watermark |
| `backend/app/render/fonts/` | Oswald and its OFL license only |
| `backend/app/schemas.py` | MatchRequest, TextBlock, artwork/story/result contracts |
| `backend/app/api/create.py`, `exports.py`, `guest.py` | Browser admission/accounting; not automatically applied to direct service calls |
| `backend/app/operations.py` | Existing durable operation/allowance support; assess before adding another ledger |
| `backend/app/main.py` | Shared startup/readiness and webhook setup; currently no bot-session shutdown |
| `backend/app/config.py`, `backend/.env.example` | Environment configuration and validation |
| `backend/Dockerfile`, `render.yaml` | One API process/worker in an existing paid Render container; static frontend |
| `backend/tests/`, `.github/workflows/ci.yml` | Offline pytest, frontend checks, container/database checks |

Original minimum: Ukrainian phrase -> meme image + reviewed story, targeting
under 15 seconds (US-12). `/random` already has an implementation to finish and
test. Inline mode in arbitrary chats is a Could (US-18), not approved MVP scope.

## Decisions to settle briefly before coding

Ask the owner only for product decisions; discover environment facts yourself.
These are recommendations, **not accepted decisions**:

| Decision | Recommended starting position |
|---|---|
| MVP interactions | Private chats only: `/start`, help, phrase and `/random`; defer inline mode, group behavior and editor parity |
| Identity and budgets | Explicitly choose a Telegram policy before public enablement. Telegram user IDs are not Supabase users or browser guest identities. Do not silently grant unlimited use or pretend browser quotas apply |
| Website linking/saving | Defer account linking and My Memes integration; no synthetic owner IDs, fake bearer tokens or automatic public saves |
| Delivery format | Decide whether compressed Telegram photos suffice or an original PNG document is required; `answer_photo` is not original-file delivery |
| Delivery/retry guarantees | Define acceptable duplicate/lost-message behavior, including a restart or Telegram timeout after a send; do not promise exactly-once external delivery |

If accounting, identity or delivery choices establish a lasting architecture
decision, record an ADR after agreement. Do not change the existing website's
accepted budgets to accommodate the bot.

Website rules to preserve: guests get three successful generations and three
distinct PNG exports independently, lifetime per browser identity. Signed-in users
are exempt from those guest allowances, not ownership checks. Saved memes and
their images are public-by-link, not private. New signed-in Save is immediate;
guest Save requires consent and Google continuation. Bookmark and favourite are
different actions.

## Concrete gaps to address

These are source-inspection findings, not reproduced production bot incidents:

- **Admission/accounting:** handlers call `match_phrase` / `suggest_captions`
  directly, bypassing HTTP generation admission and PNG-export accounting.
  Reuse creation logic, but put the agreed bot policy at an explicit shared or
  bot-specific seam. Do not call browser HTTP handlers with fabricated identities.
- **Callbacks:** `_pending` is an unbounded process-local dictionary. Entries have
  no expiry or user/chat binding. Callback parsing assumes a valid shape and
  integer index; it pops state before rendering succeeds. Validate malformed,
  out-of-range, stale, duplicate and foreign-user callbacks, and define retry and
  restart behavior. Avoid losing a valid choice on a transient image/send error.
- **Webhook retries:** processing is synchronous inside the webhook request, with
  no durable update deduplication. Registration calls
  `set_webhook(..., drop_pending_updates=True)` at every API startup. Polling also
  drops pending updates. Review these intentional-loss/retry behaviors before
  using a real bot. An in-memory background task is not a durable queue.
- **Webhook verification/lifecycle:** only a URL-path secret is currently checked;
  Telegram's secret-token header is not configured. Review authenticating
  requests without leaking secrets in logs. Registration failure currently
  prevents shared API startup; choose explicit failure/readiness behavior and
  close the bot HTTP session on shutdown. Do not hide startup failures.
- **Input/errors:** generic text goes straight to the matching service instead of
  through `MatchRequest` validation (1-200 characters). Unknown commands can reach
  this handler. Only phrase moderation errors are handled; `/random`, callbacks,
  missing catalogue items, fetch/render failures and Telegram send failures need
  deliberate Ukrainian user feedback and safe diagnostic logging.
- **Rendering/capacity:** Pillow runs synchronously in async handlers on the
  shared API process. Bound work/concurrency and keep CPU work from blocking web
  traffic. Verify long text, Ukrainian glyphs (`ґ є і ї ʼ`), line wrapping,
  watermark and portrait/landscape output. Only Oswald is packaged; do not claim
  full browser font parity or add every font unless required.
- **Story delivery:** `story_text` truncates a combined caption to 1024 Python
  characters and omits available source links. Verify Telegram's actual caption
  length rules, including emoji; preserve reviewed attribution/context without
  presenting generated captions as historical facts.
- **Testing:** there are no dedicated bot tests. Existing tests force the token
  empty, so a green suite does not establish a working webhook or bot flow.

The existing unbounded match/query caches are also single-process limitations.
Keep changes proportionate to bot traffic; do not expand this into a distributed
infrastructure rewrite. Rate limiting and circuit breakers were deferred for the
website; a new bot access/budget policy still needs an explicit decision.

## Suggested implementation sequence

1. Confirm scope and the unresolved policies above; inspect current `main`.
2. Add focused offline bot tests with mocked Telegram transport, image fetches,
   AI and persistence. Capture the agreed failure/retry behavior before changing
   it. Keep tokens fake and block unintended live calls.
3. Finish handler validation, bound callback state, ownership and errors. Keep
   transport code thin; share the existing creation and rendering behavior.
4. Finish webhook authentication, lifecycle and the chosen delivery/admission
   semantics. Test duplicate/concurrent updates and failures before rollout.
5. Run polling against a **separate test bot** and offline/local data first.
   Never point polling at the production token: it removes that bot's webhook.
   Preview configuration must be explicit; ignored local env files may point to
   real Supabase even when other settings are stubs.
6. Document exact configuration, test evidence, known limitations and rollback.
   Obtain the owner's acceptance before merge/production enablement.

Avoid adding Redis, another database, a worker service or paid compute by default.
If the agreed guarantees require one, present the cost/complexity tradeoff first.
Keep Docker/env-driven portability and the approximately $25/month target.

## Validation and release gate

Use Python 3.11 and existing tooling. From `backend`, run focused new bot tests,
then `pytest -q`. `tests/conftest.py` sets local data/stub AI/auth and an empty bot
token; preserve offline isolation. Patch cached settings/bot dependencies
explicitly and clean up between tests. Reuse Docker checks from DEPLOYMENT when
runtime/container files change. Run the existing frontend/browser checks if shared
web contracts or behavior change; do not add tooling just for this handoff.

Minimum bot acceptance:

- `/start`, help, unknown command, non-text and invalid/overlong text behavior.
- Phrase and `/random` success with a valid image, Ukrainian caption and story.
- Moderation refusal, AI fallback and fetch/render/send failures.
- Invalid, foreign-user, expired, repeated and concurrent callbacks.
- Disabled bot; rejected unauthenticated webhook; validated real update dispatch.
- Chosen deduplication/admission behavior under retries, restart and delivery
  failure; unchanged web allowance/owner-only behavior.
- Human verification with the test bot, including source links and original-file
  quality if required. Measure the 15-second target; do not infer it from mocks.

Release only on explicit approval:

- Use granular commits and one coherent PR; do not trigger CI after every commit.
  Existing required checks are `backend`, `frontend`, `containers`.
- Render follows checked `main` with service-specific build filters. Blueprint
  auto-sync is disabled. Code deployment does not apply new environment settings.
- Configure the bot token privately in the existing API service. Keep the
  existing webhook secret, guest signing secret, Supabase settings and working
  Google callback settings unless an approved change requires otherwise.
- Verify actual deployed SHA, `/api/ready`, website health and the bot's real
  webhook status/delivery. Sanitize webhook URLs and errors before sharing them.
- Prepare an explicit disable/rollback procedure, including whether to remove
  the webhook and what happens to pending updates. Never drop updates casually.
- Do not rerun `data/schema.sql`, imports, embedding jobs or either already-applied
  auth/export migration. Any new migration needs separate review and approval.
- Never commit tokens, ignored `.env` files, internal/session artifacts or manual
  test records. Do not create real public saved memes as incidental test data.

Prior unrelated follow-ups remain unconfirmed: a human completing the hosted
Google callback with automatic Save, and an older unreplicated guest-bookmark
report. Do not claim bot work fixes either.
