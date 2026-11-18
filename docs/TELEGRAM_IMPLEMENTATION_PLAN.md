# Telegram bot implementation plan

Status: first implementation pass and local test-bot acceptance completed on
2026-11-18; offline backend suite passes (164 tests). Hosted webhook acceptance
and public release are still pending. Real Gemini caption generation needs a
follow-up check after the provider returns a successful response. See
[TELEGRAM_TESTING.md](TELEGRAM_TESTING.md) for evidence and instructions, and
[TELEGRAM_HANDOFF.md](TELEGRAM_HANDOFF.md) for the starting code map. The staged
hosted-release runbook is [TELEGRAM_PRODUCTION_HANDOFF.md](TELEGRAM_PRODUCTION_HANDOFF.md).

## Agreed first release

- Private chats: `/start`, `/help`, a typed phrase that returns a finished meme,
  and `/random` with three caption choices. Unknown commands and unsupported
  messages receive a useful Ukrainian response. Group and inline interactions,
  editing, account linking, and saving to My Memes are outside this release.
- Use a separate BotFather test bot for local polling;
  hosted webhook acceptance belongs to the restricted production pilot. An allowlist of
  Telegram user IDs limits generation to invited testers. Store IDs in private
  configuration. Other users receive a Ukrainian testing notice before any
  catalogue, AI, image, or rendering work.
- Each finished meme is sent as a convenient photo with its story and as the
  original PNG document. `/random` first shows the artwork photo, three full
  captions in text and three numbered buttons; the chosen meme then gets both
  formats.
- Include reviewed artwork and artist facts and source links. If photo-caption
  space is insufficient, send the remaining story in a separate text message.
  Generated meme text must not be represented as a historical fact.
- During testing, occasional duplicate responses or a request to retry after a
  timeout or restart are acceptable. Explain failures and retries clearly; do not
  claim exactly-once delivery. Keep website allowances and ownership rules intact.
- Unrestricted public access and its per-Telegram-user usage limit require a separate
  decision after the invited production pilot. This PR must not accidentally make generation
  public. Production rollout is separate from a tested PR.

## Implementation sequence

1. **Capture current behavior.** Add offline bot tests with fake Telegram updates,
   transport, repository, AI, and image fetching. Keep live tokens and Supabase out
   of the test environment. Cover the agreed success and failure paths before
   changing handlers.
2. **Make handlers safe and predictable.** Validate phrase length and commands,
   enforce private chat and tester access before expensive work, and give Ukrainian
   responses for moderation, empty catalogue, rendering, fetch, and send failures.
   Keep calls to the existing `match_phrase` and `suggest_captions` services.
3. **Finish `/random` state.** Bind each choice to its requesting user and chat;
   validate callback shape and index; bound state size and lifetime; handle stale,
   foreign, duplicate, and concurrent presses. Retain a valid choice when render
   or send fails so the tester can retry. Document restart behavior.
4. **Deliver image and context.** Bound image work and move synchronous Pillow
   rendering off the event loop. Check Ukrainian glyphs, long captions, both image
   orientations, watermark, photo rendering, original PNG document, and source
   links. Measure time to the final response against the original 15-second goal.
5. **Harden webhook and lifecycle.** Validate Telegram's webhook secret token as
   well as the configured route, reject malformed updates, close the bot session
   on shutdown, and report bot registration failure separately from shared API
   readiness. Avoid clearing pending updates during ordinary startup or polling.
   Define retry and update-deduplication behavior consistent with the accepted
   test-phase delivery guarantee.
6. **Verify and document.** Run focused bot tests and `pytest -q`, then test the
   separate bot with local catalogue/stub AI. Run a small private acceptance pass
   with real catalogue and Gemini settings, including image quality, attribution,
   error handling, and elapsed time. Record configuration, evidence, limitations,
   and rollback. Prepare one PR for review.

## Release boundary

The invited production pilot stays allowlisted. Verify the real webhook, token
configuration, deployed revision, readiness, and end-to-end delivery using the
production runbook, including its disable/rollback path. Agree on a public usage
policy before opening access beyond invited testers.
Do not use the production bot token for local polling: polling modifies that
bot's webhook. Do not add paid infrastructure or database migrations without a
reviewed reason tied to the agreed guarantee.
