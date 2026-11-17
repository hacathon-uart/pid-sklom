# ADR 0003: A portable, deliberately small first release on Render

- **Status:** Accepted
- **Date:** 2026-11-17
- **Related:** [Deployment map](../DEPLOYMENT.md), [ADR 0001](0001-artwork-data-storage.md)

Deploy to Render first, but describe both applications with Dockerfiles so a later
hosting move does not require reconstructing their build/runtime environments.
Initially run the FastAPI container as one always-on web service and publish the
frontend build as a free Render Static Site. Keep the frontend container available
as an alternative deployment target, not a second paid server by default.

Use the existing application and repository interfaces rather than introducing a
new provider-abstraction framework. Configuration, disposable application disks,
standard HTTP and external durable data keep the hosting seam portable. Containers
do not make Supabase Auth/Storage or embedding models interchangeable: moving those
requires explicit adapters, data migration and, for an embedding-model change,
regenerating compatible vectors.

Approximately **$25/month is a planning target**, not an enforced or guaranteed
all-inclusive spending cap. Start with Render Hobby, one Starter instance and
Supabase Free; no separate vector database, Redis, worker service or paid workspace
upgrade is required for this iteration. Database usage is expected to stay below
500 MB; image files have their own Storage quota. Measure memory before buying a
larger instance. Provider limits, free-project pausing and usage overages still apply.

## Release scope and deliberate deferrals

- Keep the first public release simple: existing website flows and embedding-based
  matching, with own/prewritten captions. Hybrid reranking, generated captions,
  admin UI and enrichment automation are not first-release prerequisites.
- Prepare optional Telegram infrastructure, but enable the bot only after its
  existing implementation passes a deployment smoke check. Bot feature development
  is outside this iteration; an unready bot stays disabled.
- Browsing and current matching stay public. Google login for generation/saving is
  a future decision to implement, not a first-release gate.
- Internal application endpoints require **server-side administrator authorization**
  whenever introduced or exposed. A normal user session is not an administrator
  role. The exact admin identity mechanism is left to that implementation; do not
  add an unprotected admin endpoint while deferring the login UI.
- Do not release personal saving under fake/stub authentication as a real account
  feature. Keep it unavailable in the public release until real user authentication
  is ready. This gate is implemented in the backend and frontend.
- Rate limiting and circuit breakers are deferred to later releases. Keep existing
  timeouts and explicit fallback behavior; these are not circuit breakers.
- No privacy redesign is included. This does not claim that public-by-link memes
  are private or change the current Storage access rules.

## Trade-offs

A static frontend avoids a second always-on server while Dockerfiles preserve a
container deployment route. A single backend keeps cost and operations small, but
its process-local caches and bot callbacks need attention before multiple replicas.
Hobby has one workspace member, so shared direct Render administration would require
revisiting the budget rather than sharing credentials.

Deferring throttling means anonymous embedding requests can exhaust Gemini quota
and trigger fallback; paid API usage could also incur costs. Use the existing
free-tier/stub path for the initial scope and do not silently enable paid capacity
under the assumption that the $25 target is a hard limit.

This ADR records the agreed direction. Dockerfiles, release feature gates,
administrator authorization and Render resources are **not implemented by it**.

Implementation checkpoint: both Dockerfiles and the Render Blueprint are now
prepared, with disabled public accounts, exact CORS and startup/readiness checks.
No administrator endpoint was introduced. Read-only Supabase startup, one live
Gemini embedding match and matched-image delivery/CORS have passed preflight.
These are not deployed-browser or load tests. Cloud provisioning and release
verification are tracked in the [deployment map](../DEPLOYMENT.md).
