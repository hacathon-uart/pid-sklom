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

Result on 2026-11-18: 162 passed, one Starlette/AnyIO deprecation warning.
This verifies bot update dispatch, restricted access, callback retries, image
format calls, webhook authentication, lifecycle, and rendering without live
Telegram or Gemini traffic.

## Separate local test bot

1. Create a **separate bot** with BotFather. Keep its token private. In BotFather,
   turn off group additions and leave inline mode disabled for this private-chat
   release. Do not use the public bot's token for polling.
2. Use Python 3.11 and install `backend/requirements.txt` in a local virtual
   environment. Keep secrets in ignored `backend/.env` or in exported environment
   variables. The test settings are `DATA_BACKEND=local`, `AI_PROVIDER=stub`,
   `AUTH_MODE=stub`, `ENVIRONMENT=development`,
   `PUBLIC_BASE_URL=http://localhost:8000`, `TELEGRAM_BOT_TOKEN` set to the test
   token, and a non-default `TELEGRAM_WEBHOOK_SECRET` of letters, digits, `_`, or
   `-`. Set `TELEGRAM_ALLOWED_USER_IDS` to comma-separated numeric tester IDs.
   With a token configured, that list cannot be empty. To learn your own ID
   without a third-party bot, start with a temporary unused positive ID, message
   `/start`, read the ID in the restricted-access response, then replace the
   temporary ID and restart both processes.
3. In one terminal run `uvicorn app.main:app --host 127.0.0.1 --port 8000` from
   `backend`; in another run `python -m app.bot.polling` with the same settings.
   Local HTTP skips webhook registration. Polling removes a webhook from this
   **test bot only** and preserves pending updates.
4. Check `/start`, `/help`, a phrase, `/random` and each caption choice. Check
   that each finished meme arrives as a photo plus an original PNG document,
   with artwork/artist context and source links. Try an uninvited account,
   unknown command, non-text message, overlong phrase, repeated button, and a
   button from another account. Check that group and inline behavior remain off.
5. Repeat a small private pass with the real catalogue and Gemini configuration
   in a controlled development environment. Measure elapsed time from sending
   the phrase to receiving the final PNG against the original 15-second target.
   Inspect Ukrainian glyphs (`ґ є і ї ʼ`), long text, portrait and landscape
   images, watermark, compression, and source attribution.

The local test bot was **not** exercised during the code pass because no test
token or tester IDs were configured. Do not mark live acceptance complete from
the offline suite.

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
