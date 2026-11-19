# Telegram demo invitations

The bot keeps its private-chat restriction and organiser ID allowlist. An optional
demo event lets other people join once through a Telegram deep link. Membership
and usage survive API redeploys because they are recorded in Supabase. The
website's guest allowance is separate.

## Attendee flow

1. Open `https://t.me/<bot_username>?start=<invite-code>` or scan its QR code.
2. Press **Start**. The bot validates the code and records the Telegram ID for
   the configured event. The code is not needed again.
3. Send a phrase or `/random`. Each accepted request uses one of five event
   generations by default. Choosing one of `/random`'s numbered captions is
   part of the same request and costs nothing more.
4. Access and generation stop at the configured event end time. An attendee
   receives a clear limit or expiry notice; organiser IDs remain available.

Uninvited users can still find the bot by username. They cannot generate a meme
without the code. Telegram messages and shared links can be forwarded, so treat
the code as a bearer invitation and rotate it if it spreads.

## Prepare and enable

1. Apply [`../data/migrations/0004_telegram_demo.sql`](../data/migrations/0004_telegram_demo.sql)
   once in the existing Supabase project's SQL editor. It adds bot-only event,
   member and request tables plus atomic RPCs. Keep the tables restricted to the
   backend's service role. Confirm the migration before enabling the demo env.
2. Generate a code locally with `openssl rand -hex 16`. Do not put the code in
   Git, public logs or the frontend. In **Render → pidsklom-api → Environment**,
   set `TELEGRAM_DEMO_INVITE_CODE` to this code,
   `TELEGRAM_DEMO_EVENT_ID` to a short lowercase ID such as `museum-demo-1`,
   and `TELEGRAM_DEMO_ENDS_AT` to a future timezone-aware ISO 8601 timestamp,
   such as `2026-12-01T18:00:00+02:00`.
3. Optionally set `TELEGRAM_DEMO_QUOTA=5` and
   `TELEGRAM_DEMO_GLOBAL_QUOTA=200`. The second is the whole event's maximum
   number of successful or reserved attendee requests. Organisers on
   `TELEGRAM_ALLOWED_USER_IDS` bypass these limits. The default
   `TELEGRAM_DEMO_MAX_CONCURRENT=4` limits simultaneous attendee requests;
   extra requests receive a busy notice and may be retried.
4. **Save and deploy** the API service. Keep the existing bot token, webhook
   secret, Supabase and Gemini values. Verify `/api/ready` and `/api/health`,
   then test from an unlisted Telegram account: bad code, valid link, phrase,
   `/random` and caption choice, repeat `/start`, and quota exhaustion. Check
   that an uninvited phrase and callback cannot generate. The health flag only
   proves webhook registration, so use an actual Telegram conversation.
5. Share the bot link or QR code with the intended demo audience. Do not share
   the BotFather token or webhook secret.

The event ID identifies the allowance period. Reusing one ID cannot extend its
first configured end time; create a new ID for a new event.

## Rotate or close

- **Rotate the invitation:** replace `TELEGRAM_DEMO_INVITE_CODE` in Render and
  deploy. Old links stop enrolling new people. Existing attendees retain access
  until the event end time. A deploy clears any process-local `/random` choices,
  so rotate between demonstrations when practical.
- **End immediately for everyone except organisers:** remove
  `TELEGRAM_DEMO_INVITE_CODE` and deploy. To run another event, use a new event
  ID and code.
- **Revoke a leaked event immediately:** change the event ID **and** code,
  deploy, and share the new link only with the intended attendees. Old members
  are scoped to the old event ID, so they cannot use the new one.

The database reserves a request before AI and image work. Successful requests
count against both limits; ordinary failed requests release their reservation.
A process crash can leave a reservation pending. After five minutes, the next
request consumes that stale reservation and releases the per-user busy state.
This conservative recovery may cost one allowance, but prevents a crash from
opening an uncounted generation path. Telegram deliveries can still duplicate
after network retries, and `/random` choices expire after ten minutes or an API
restart.
