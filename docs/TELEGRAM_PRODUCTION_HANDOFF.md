# Telegram production deployment handoff

For the later self-service demo invitation flow, see
[Telegram demo invitations](TELEGRAM_DEMO_ACCESS.md). This document records the
earlier ID-only pilot and its original release checklist.

Prepared 2026-11-18 from `feat/telegram-bot`. This is a release
runbook, not a record of a hosted bot deployment. The local polling test bot
`@pid_sklom_test_bot` is separate from the intended production bot.

## Release decision

Deploy **an invited-tester production pilot first** in the existing `pidsklom-api`
Render service. The code requires `TELEGRAM_ALLOWED_USER_IDS`; leaving it empty
does not make the bot public. The username can be found by anyone, but only listed
IDs can use generation. Opening access to everyone requires a separate product and
implementation decision for per-user limits, durable accounting and abuse/cost
controls. Do not use the local test bot's token as the production token.

The bot runs in the API's single FastAPI process via a Telegram webhook. There is
no bot worker, new database table or second paid service in this release. The
browser's guest limits and accounts do not apply to Telegram IDs. `/random`
choices are process-local for ten minutes and disappear on restart. Webhook
retries and partial sends can repeat output. See [testing](TELEGRAM_TESTING.md).

## What the owner supplies

| Item | Where it goes | Acceptance |
| --- | --- | --- |
| Separate production BotFather bot and token | `TELEGRAM_BOT_TOKEN` on `pidsklom-api` only | Bot username confirmed with `getMe`; token stays out of Git, chat, logs and frontend variables |
| Invited Telegram numeric IDs | `TELEGRAM_ALLOWED_USER_IDS` on `pidsklom-api` | Comma-separated positive IDs, including the release tester; private chats only |
| Production bot avatar | Set from [`../assets/telegram-avatar.jpg`](../assets/telegram-avatar.jpg) with BotFather or `setMyProfilePhoto` | Profile shows the glass-pane logo |
| Release scope | Owner decision | Pilot remains allowlisted; public access is a later release |

In BotFather, disable group additions and leave inline mode off for this private
chat release. Confirm the bot's username and share its `https://t.me/<username>`
link with invited testers after hosted acceptance.

## Before enabling the token

1. Refresh `main` and this branch; resolve drift before opening one PR targeting
   `main`. Review the bot diff and verify no ignored `.env` file, token or private
   tester record is staged. Recheck the diff against the actual remote before
   publishing; preserve newer website changes from `main`.
2. Run the offline backend suite (`cd backend && python -m pytest -q`) and the
   PR checks `backend`, `frontend`, `containers`. The last local run had 164
   passing backend tests. Review and merge the PR only after checks pass.
3. Keep `TELEGRAM_BOT_TOKEN` unset while the code first reaches Render. Verify
   the deployed API commit, `GET /api/ready` returning 200, the website's normal
   flows and `GET /api/health` reporting `bot: false`. Render is configured for
   `checksPass`, but the existing deployment notes say GitHub-triggered automatic
   deployment still needs a real merge verification. If no deployment starts,
   investigate that connection before configuring the bot; do not assume code is
   live from a green PR alone.
4. Confirm the existing API has production Supabase catalogue, approved images,
   compatible embeddings and working `AI_API_KEY`. Verify the live caption API
   returns `source: ai` at least once with the intended `AI_MODEL`. The local bot
   pass verified the fallback path, while real Gemini `/random` captions timed
   out or returned 503. Review the factual `story` caption limitation in
   [known issues](KNOWN_ISSUES.md) with the release tester.
5. Inspect the **existing** `TELEGRAM_WEBHOOK_SECRET` value privately. The
   previous Blueprint used `generateValue: true`; Render's generated base64
   value may contain `+`, `/` or `=`, while `Settings.validate_runtime()` accepts
   only `A-Z`, `a-z`, `0-9`, `_` and `-` (1–256 characters). Set a strong random
   URL-safe value manually in Render before enabling the token:

   ```sh
   openssl rand -hex 32
   ```

   The Blueprint now uses `sync: false` for fresh services. Enter the value in
   the service dashboard; updating an existing Blueprint does not prompt for
   `sync: false` values. Keep an existing valid secret across ordinary deploys.

## Enable the hosted pilot

1. In Render, open **pidsklom-api → Environment**. Add the production bot token,
   URL-safe webhook secret and allowlist to that service only. Check
   `PUBLIC_BASE_URL` is the API's public HTTPS origin, with no trailing path.
   Preserve all existing Supabase, Gemini, Google auth, guest allowance and CORS
   settings. Enter the three bot values together and choose **Save and deploy**
   once. Do not rely on a Blueprint sync to set new `sync: false` secrets on an
   existing service. [Render environment variable behavior](https://render.com/docs/configure-environment-variables)
   and [Blueprint rules](https://render.com/docs/blueprint-spec) apply here.
2. Wait for the API deploy to become healthy. `GET /api/ready` must return 200;
   `GET /api/health` must show `bot: true` and `bot_webhook_ready: true`. The
   second flag means registration succeeded during startup; it does not prove
   Telegram delivered an update. Check logs for `Telegram webhook set` without
   exposing the URL or secrets.
3. From a trusted environment holding the production token, call `getMe` and
   `getWebhookInfo`. Confirm the expected bot username, HTTPS API host, the
   `/telegram/webhook/` path, `message` and `callback_query` in allowed updates,
   a falling pending-update count, and no new delivery error. **Redact the full
   webhook URL** because its path contains the secret. Do not run local polling
   with this token: polling calls `deleteWebhook`.

   In the Render API service shell, this check prints no token or webhook URL:

   ```sh
   python - <<'PY'
   import asyncio
   import os
   from aiogram import Bot

   async def check():
       async with Bot(os.environ["TELEGRAM_BOT_TOKEN"]) as bot:
           me = await bot.get_me()
           info = await bot.get_webhook_info()
           expected = (os.environ["PUBLIC_BASE_URL"].rstrip("/")
                       + "/telegram/webhook/" + os.environ["TELEGRAM_WEBHOOK_SECRET"])
           print({"username": me.username, "webhook_matches": info.url == expected,
                  "pending": info.pending_update_count,
                  "allowed_updates": info.allowed_updates,
                  "last_error_date": info.last_error_date})

   asyncio.run(check())
   PY
   ```
4. Have an allowlisted tester check `/start`, `/help`, one Ukrainian phrase,
   `/random`, each numbered choice, source links, bold text, preview, finished
   photo and original PNG. Confirm an unlisted user gets only the access notice
   and their ID. Check API website readiness during these calls. Measure time to
   the final PNG against the original 15-second target; record actual timings,
   fallback frequency and any duplicate/retry behavior.
5. Restart or redeploy once while no choice is active, then check webhook
   registration and a new phrase again. A choice made before restart may expire
   and legitimately require another `/random`. Confirm the production bot avatar
   and BotFather group/inline settings. Share the bot link only after these checks.

[Telegram's Bot API](https://core.telegram.org/bots/api) documents
`setWebhook`, its secret-token header, `getWebhookInfo`, update retries and
`deleteWebhook`. The code sets the same secret in the path and header and does
not request `drop_pending_updates` on normal registration.

## Stop or roll back

If bot delivery fails but the website is healthy, first **remove the production
webhook without dropping pending updates** using the production token in a
trusted environment. Then remove `TELEGRAM_BOT_TOKEN` from the Render API
environment and deploy. Confirm `/api/health` shows `bot: false` and the website
still works. Pending updates may remain at Telegram; decide whether to resume
them before restoring the bot. Do not rotate or print the production token as a
routine stop step. In the Render API service shell, the removal call is:

```sh
python - <<'PY'
import asyncio
import os
from aiogram import Bot

async def stop():
    async with Bot(os.environ["TELEGRAM_BOT_TOKEN"]) as bot:
        print("webhook removed:", await bot.delete_webhook(drop_pending_updates=False))

asyncio.run(stop())
PY
```

Finish the environment change promptly; starting the API again while the token
is still configured will register its webhook again.

If the code revision harms the API or website, use Render's **Deploys → Rollback**
to a known-good deploy and verify readiness, the actual commit and bot env state.
[Render rollbacks](https://render.com/docs/rollbacks) restore the selected
deploy's environment variables and disable automatic deploys when started from
the dashboard; re-enable automatic deploys deliberately after a fix. A rollback
does not itself remove an existing Telegram webhook, so inspect `getWebhookInfo`
and remove or re-register it as appropriate. Record which deploy, token state
and pending-update count were left in place.

## Exit criteria and remaining decisions

- Hosted pilot: matching deployed SHA; healthy website/API; expected bot account;
  webhook deliveries without fresh errors; allowlist enforced; both generation
  flows produce a real approved painting, clickable sources, photo and PNG.
- Product decision before public access: define per-user usage and spend limits,
  where counters live, abuse handling and whether Telegram users can link to web
  accounts. The current bot cannot safely become open simply by clearing the
  allowlist.
- Quality follow-up: make one real Gemini caption-generation success observable
  and resolve the known historical-fact risk in `story` captions before claiming
  that generated history is verified.
