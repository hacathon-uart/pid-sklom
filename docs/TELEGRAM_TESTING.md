# Telegram bot testing and release notes

The first bot release is limited to invited users in private chats. The website
remains available when Telegram webhook registration fails; `/api/health` exposes
`bot_webhook_ready` for that condition. A malformed enabled-bot configuration
still prevents API startup.

## Offline verification

The backend tests use a fake Telegram transport and run without credentials or
network access. From the repository root, with a Python 3.11 environment and
`backend/requirements.txt` installed:

```sh
cd backend
python -m pytest -q
```

The Docker alternative uses the checked-in backend image and mounts the test
sources read-only. This is the command used for the implementation pass:

```sh
docker build -f backend/Dockerfile -t pid-sklom-bot-test .
docker run --rm --network none \
  -v "$PWD/backend:/app/backend:ro" \
  -v "$PWD/data:/app/data:ro" \
  -v "$PWD/scripts:/app/scripts:ro" \
  -w /app/backend -e PYTHONDONTWRITEBYTECODE=1 \
  pid-sklom-bot-test python -m pytest -q -p no:cacheprovider
```

Result on 2026-11-18: 164 passed, one Starlette/AnyIO deprecation warning.
This verifies bot update dispatch, restricted access, callback retries, image
format calls, webhook authentication, lifecycle, and rendering without live
Telegram or Gemini traffic.

Release-polish verification on the same date: 167 passed, with the same warning.
Handler admission now uses the same strict allowlist parser as configuration and
the transport gate, including rejection of empty entries and nonpositive IDs.

## Separate local test bot

The bot avatar is `assets/telegram-avatar.jpg`, rendered from
`assets/telegram-avatar.svg`: the homepage's large `LogoMark` in
`frontend/src/components/Museum.tsx`, with both glass reflections, on the site's
cream background. Keep the mark inside the center of the square so Telegram's
circular crop preserves it.
The test bot profile photo was set with Telegram's `setMyProfilePhoto` method.
Avatar uploads are a separate profile operation, not repeated at app startup.
Telegram stores the uploaded avatar independently of Render deployments.

Both polling and HTTPS webhook startup register `/start`, `/help`, and `/random`
with Ukrainian descriptions and Telegram's native command menu in private chats.
Typing `/` filters these suggestions; the tester allowlist still controls access.

1. Create a **separate bot** with BotFather. Keep its token private. In BotFather,
   turn off group additions and leave inline mode disabled for this private-chat
   release. Do not use the public bot's token for polling.
2. On this machine, Docker provides the required Python 3.11 runtime. From the
   repository root, copy the example and fill in the **test** token in the ignored
   local file:

   ```sh
   cp backend/telegram-test.env.example backend/.env.telegram.local
   # Edit backend/.env.telegram.local: set TELEGRAM_BOT_TOKEN to the test token.
   docker compose -f compose.telegram-test.yaml up --build
   ```

   The Compose setup forces local catalogue, stub AI, development mode, and an
   internal URL between its API and polling containers. It does not use the
   existing `backend/.env` or the public bot. Local HTTP skips webhook
   registration. Polling removes a webhook from this **test bot only** and
   preserves pending updates. Keep Compose running while testing.
3. The example allowlist starts with a temporary unused positive ID so the bot
   can start. Message `/start` to the test bot; its restricted-access response
   gives your numeric Telegram ID. Replace the temporary ID in
   `TELEGRAM_ALLOWED_USER_IDS` with your ID and restart Compose with
   `docker compose -f compose.telegram-test.yaml up --build --force-recreate`.
   The allowlist must contain at least one ID while a token is configured.
4. Check `/start`, `/help`, a phrase, `/random` and each caption choice. For
   `/random`, confirm all three captions are fully visible in the numbered text
   above the short choice buttons. Check that each finished meme arrives as a
   photo plus an original PNG document, with bold artwork/artist context and
   clickable source labels. Try an uninvited account,
   unknown command, non-text message, overlong phrase, repeated button, and a
   button from another account. Check that group and inline behavior remain off.
5. Repeat a small private pass with the real catalogue and Gemini configuration
   in a controlled development environment. Measure elapsed time from sending
   the phrase to receiving the final PNG against the original 15-second target.
   Inspect Ukrainian glyphs (`ґ є і ї ʼ`), long text, portrait and landscape
   images, watermark, compression, and source attribution.

### Local acceptance on 2026-11-18

- A separate test bot polled Telegram locally with one invited tester. The tester
  confirmed the phrase flow delivered the artwork story and original PNG, and
  `/random` delivered its painting preview and the selected meme as photo and
  original PNG. Bot logs showed handled updates without delivery errors.
- With local seed data and stub AI, both flows completed with placeholder or
  seed imagery as configured. A local HTTP image fetch succeeded for each path.
- A bounded real-data pass loaded 13 approved Supabase artworks and 108 compatible
  vectors. A phrase used Gemini embedding matching, fetched an approved artwork,
  and completed in about four seconds. The tester confirmed delivery.
- A real-catalogue `/random` preview and caption callback both completed and the
  tester confirmed delivery. Captions came from the reviewed fallback path:
  the local ignored `.env` has an empty `AI_MODEL`, yielding a 404 from the
  caption endpoint. Google's model list confirms that the application's default
  `gemini-3.1-flash-lite` supports `generateContent`, but two controlled checks
  with that model received a Gemini 503 and then exceeded the configured
  eight-second timeout. Real Gemini caption generation is therefore **not yet
  verified**; the fallback behavior worked. The local bot was restored to seed
  data and stub AI after this pass to avoid ongoing provider use.

Hosted webhook delivery and a public usage policy remain separate release gates.

### Inviting another tester

Share `https://t.me/<test_bot_username>` with the person. The link opens the
bot, but it does not grant access: Telegram usernames are searchable. Ask them
to press **Start**. The restricted-access reply shows their numeric Telegram ID;
ask them to send you that ID. Add it to the comma-separated
`TELEGRAM_ALLOWED_USER_IDS` in `backend/.env.telegram.local` (for example,
`123456789,987654321`), then recreate the local Compose services. They can now
send a phrase or `/random` while your computer and the Compose services are
running. Do not send the BotFather token to testers.

## Behavior and later release gate

- `/random` choices are bound to one user/chat, capped at 256 active choices,
  and expire after ten minutes. A restart clears them; users send `/random` again.
- A failed send leaves a valid choice available for retry. A partially delivered
  response can repeat after retry. A phrase update may also repeat after a
  webhook timeout. There is no durable queue or exactly-once Telegram delivery.
- Bot admission uses the explicit Telegram tester allowlist. The browser's guest
  allowances and saved-meme ownership rules do not apply to Telegram identities.
- Before enabling a public bot, agree on a public usage limit and its durable
  accounting, verify the hosted webhook and deployed revision, and review the
  rollback procedure. Remove a webhook without `drop_pending_updates` before
  disabling its token if pending delivery matters. Production enablement is a
  separate decision from merging the tested code.
