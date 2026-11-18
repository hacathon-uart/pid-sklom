# ADR 0006: Google identity, public-by-link collections and a three-generation guest allowance

- **Status:** Accepted; production enablement requires a separately approved release.
- **Date:** 2026-11-18
- **Related:** [Authentication map](../AUTHENTICATION.md), [ADR 0001](0001-artwork-data-storage.md),
  [ADR 0003](0003-portable-render-first-release.md)

Use Google through Supabase Auth for identity, while keeping saved-meme writes and
ownership enforcement in FastAPI. The browser gets its own Supabase session and
public project key; it never receives the backend service credential. Verify
Supabase-issued tokens against the project's configured signing algorithm and
issuer. There is no separate application user database or first-user admin rule.

Guests receive three successful generations combined across matching and caption
suggestions, including successful fallback results. The allowance does not reset
daily; manual editing and PNG downloads remain free. A signed-in user is exempt
from this guest allowance, not from ownership checks.

## Trade-offs

The guest identity is a backend-signed browser credential, not an anonymous
Supabase Auth account. Store its authoritative operations in Postgres and reserve
slots atomically before provider work; process-local counters would reset on
restart and race across instances. Deliberately accept clearing browser storage,
incognito and another browser as bypasses. This is a registration gate, not a
person-level anti-abuse mechanism or a spending cap. General throttling and
circuit breakers remain separate work.

Google redirects must preserve drafts and complete the explicitly requested save
or blocked generation on return. Persist request identities and results so
duplicate callbacks and lost-response retries reuse the same logical operation.
Use bounded reservations and fencing tokens so crashed workers do not hold guest
slots forever. Stable owner-scoped meme IDs recover a save committed before its
response/operation record was received. Do not retry a cancelled login implicitly.

Saved memes remain public by link, including PNGs; disclose this before saving.
The collection listing and mutations remain owner-only. An explicit confirmed
Delete action replaces destructive bookmark toggles and removes the hosted meme;
it cannot recall previously downloaded or cached copies. Private buckets and
explicit publication are deferred rather than implied by the presence of login.

Keep the existing static frontend, one backend and Supabase: no new paid instance,
Redis or queue. These choices introduce a reviewed database migration and retained
operation records; monitor database growth, PNG storage and authenticated provider
usage. Authentication is not an unlimited-cost guarantee.
