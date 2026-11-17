# Google sign-in and saved-meme behaviour

Status: implemented on the feature branch; not enabled in production.
Date: 2026-11-18.

Production accounts remain disabled pending provider configuration and release acceptance.
Decisions are recorded in [ADR 0006](adr/0006-google-identity-and-guest-allowance.md).
This builds on the Supabase choice in [ADR 0001](adr/0001-artwork-data-storage.md)
and the account/admin safeguards in
[ADR 0003](adr/0003-portable-render-first-release.md). It does not introduce an
admin role, an admin user seed or an admin interface.

## Behaviour

| Action | Guest | Signed-in user |
| --- | --- | --- |
| Browse | Available | Unchanged |
| Phrase matching, generated captions | Three successful requests combined per browser guest; then require Google sign-in | Available without the guest allowance |
| Edit an unsaved meme, download PNG, share an image file | Available | Unchanged |
| Save to My Memes | Start Google sign-in, preserving the draft; complete the requested save after successful return | Save to their own collection |
| Open My Memes | Offer sign-in, preserving the destination | List only their saved memes, newest first; allow favourites filtering |
| Favourite a saved meme | Unavailable | Owner can toggle; this does not delete anything |
| Edit a saved meme | Unavailable | Owner only; update the existing meme |
| Delete a saved meme | Unavailable | Explicit Delete action with confirmation, not a destructive bookmark toggle |
| Open a public share link | Read-only | Read-only public presentation; editing requires verified ownership |
| Admin operations | Unavailable | Unavailable; ordinary sign-in grants no admin privileges |

Saved memes and PNGs remain **public by link**, not private. Explain this before
the first save, including a save initiated by a guest before the OAuth redirect.
There is no public collection directory implied by this decision. The owner-only
collection listing does not make an individual saved meme private.

Deleting removes the saved meme, its collection entry and its hosted PNG; its
shared page becomes unavailable. Confirmation should explain that existing links
will stop working. Already downloaded or cached copies cannot be recalled.
Cancelling deletion leaves the meme unchanged.

The latest editor draft, including unsaved caption/style/frame changes, survives
a reload in the same browser tab. Restoring that draft does not publish changes:
updating the saved meme, including its frame, requires explicit Save. Browser
storage failures are shown rather than silently claiming the draft is durable.

## Three-generation guest allowance

Guests can complete **three successful phrase-match or caption-generation
requests combined** before signing in. Google sign-in creates an account if
needed; there is no separate registration form.

- A phrase-match response uses one slot, not one per returned alternative.
- A caption-generation response uses one slot, not one per suggested caption.
  Requesting more variants uses another slot.
- A successful usable fallback response also counts. Failed requests do not.
- Browsing, manual caption/frame editing, downloading PNGs and sharing an image
  file do not consume slots. These remain possible after the allowance runs out.
- Show the remaining allowance near generation controls. After three successful
  operations, offer Google sign-in instead of starting another provider call.
  Keep the existing draft/result available through that flow.
- Signing in removes this guest restriction; it does not automatically grant
  admin privileges or introduce a paid tier. Signing out in the same browser
  does not reset its existing guest allowance.

Use a backend-issued, unguessable guest credential retained by the browser.
Keep authoritative usage in Supabase Postgres, not an editable browser counter
or an in-process backend cache. A guest credential is not an authenticated user
session and must never authorize saving, ownership operations or admin access.
Do not create a Supabase Auth user merely to count guest generations.

The backend checks and reserves an available slot atomically **before** calling
Gemini, counts a successful result and releases the reservation on failure.
Concurrent requests must not exceed the three-slot allowance. Reservations need
bounded recovery after interrupted requests/process restarts. These operations
require database support separate from meme-creation idempotency.

At the limit, return an explicit machine-readable guest-limit response so the
frontend can show the sign-in prompt rather than a generic generation error.
Failed or cancelled sign-in leaves the draft intact and the allowance unchanged.
After sign-in, automatically complete the explicitly blocked generation once.
Do not regenerate earlier results or replay a cancelled action.

This is deliberately a **per-browser signup gate**, not reliable person-level
abuse prevention. Clearing storage, using incognito or another browser can obtain
a new guest identity; that bypass is accepted. Do not add IP fingerprinting or
claim this caps total Gemini spend. General rate limiting/circuit breakers remain
separate deferred work, and authenticated usage can still incur provider costs.

## Sign-in initiated by Save

1. Capture the selected artwork and complete editable style: caption blocks,
   positions, fonts, colours and frame. Preserve the editor destination and the
   explicit pending Save action across the full-page OAuth redirect. Do not rely
   on React state or URL parameters alone.
2. Keep the pending draft in tab-scoped temporary browser storage, separately
   from the Supabase-managed session. Regenerate the PNG from the restored draft
   rather than storing a large base64 PNG there. If storage is unavailable, show
   an actionable error before redirecting rather than silently losing the draft.
3. Use Supabase's Google OAuth flow with a configured application return location.
   Let the auth SDK manage the OAuth security flow; validate restored application
   destinations as local routes.
4. On return, finish session restoration first, restore the draft and wait for
   the artwork/fonts/canvas to be ready. Only then export the PNG and submit Save
   using the authenticated session.
5. On success, mark the editor as saved, retain the returned meme ID and show the
   existing saved confirmation/link. Subsequent edits save to that same ID.
6. On cancellation or authentication failure, preserve the draft and show that it
   was not saved. A later unrelated login must not unexpectedly save a cancelled
   draft. On save failure, preserve the draft and offer retry; never show success
   before persistence succeeds.

An ordinary Login action does not create a pending Save action. Logout clears
the session, account-specific UI data and pending authenticated mutations, but
does not delete saved memes from Supabase. Users can continue public creation.
An expired session must not discard editor work or silently replay other
mutations such as deletion.

### One logical save, including retries

Assign a stable random save-intent identifier before leaving for Google. Repeated
callbacks, double clicks or a lost HTTP response must not create duplicate memes.
Frontend button disabling alone is insufficient.

The backend must enforce idempotency for creation, scoped to the verified user
and save-intent identifier, returning the same meme for a retry of the same
operation. Reusing an identifier with a different payload must be rejected.
The `app_operations` table in `data/migrations/0001_auth_operations.sql` supplies
durable uniqueness, stored results and 120-second fenced reservations. Creation
uses an owner/intent-derived meme UUID, so a committed save survives loss of its
response or operation completion. The fingerprint covers artwork/style, not PNG
encoding differences produced by re-rendering the same draft.

## Supabase integration

```text
Browser -> Supabase Auth -> Google
Google -> Supabase Auth callback -> application return location
Browser -> FastAPI with Supabase access token
FastAPI -> verify Supabase token -> derive user UUID -> enforce ownership
FastAPI -> Supabase Postgres: meme metadata, ownership, idempotency, guest allowance
FastAPI -> Supabase Storage: exported PNG
```

- **Identity:** Supabase Auth creates/returns the user's identity. Use its stable
  UUID as `memes.user_id`, never a browser-supplied owner ID or an email address.
  Google supplies identity to Supabase; FastAPI accepts Supabase access tokens,
  not Google access tokens.
- **Session:** the existing frontend Supabase client owns persistence and token
  refresh. The auth module exposes restoring, signed-out and signed-in states;
  account requests wait for restoration. Sign-in, sign-out and refresh events
  update the bearer token used by the existing backend client.
- **Verification:** check the project's actual signing-key configuration. The
  backend supports configured ES256/RS256 via cached JWKS, or explicitly selected
  legacy HS256. It validates signature,
  expiry, expected issuer, audience and a valid subject.
- **Database:** keep using the existing `memes` table for artwork reference,
  caption/style, PNG URL, favourite status, creation date and owner UUID.
  A separate application profile table is unnecessary for initial Google login;
  name/avatar can come from the Supabase session.
- **Storage:** keep PNGs in the existing public `memes` bucket. Browser download
  of an unsaved PNG still does not upload it. Saving uploads the PNG through
  FastAPI; the browser does not receive a service-role credential.
- **Authorization:** retain backend-mediated writes. Its service credential
  bypasses RLS, so every owner-specific operation needs server-side enforcement.
  Foreign-owner edits/deletes return not found. Individual public reads remain
  available by link; frontend route names are not authorization.
- **Admin:** no first-user-is-admin rule and no privileges derived from
  user-editable profile metadata. Future admin grants require a separate,
  trusted server-controlled mechanism.

## Configuration and implementation work

1. Owner configures a Google web OAuth client, consent/audience settings and the
   Supabase callback URL. Enable Google in Supabase; place its client secret
   there, not in the frontend or GitHub. Basic scopes only: openid, email, profile.
2. Configure Supabase Site URL and explicit application redirect allowlist.
   Configure frontend `VITE_SUPABASE_URL` and its public anon/publishable key
   using the supported frontend variable. These are public identifiers, not
   service credentials.
3. Finish the auth/session module, draft restoration and pending-save flow.
   Handle provider errors explicitly; never fall back to fake production login.
4. Finish token validation, durable create idempotency and atomic guest-allowance
   tracking. Apply reviewed, versioned migrations for the required database changes;
   do not rerun the full bootstrap schema on deployment. Align decoded PNG
   validation with the bucket's 5 MiB limit. Handle upload/row consistency and
   deletion failures explicitly so retries do not silently leak objects or claim
   success before the requested work completes.
5. Replace destructive bookmark toggles with explicit confirmed deletion in
   editor and saved-meme views. Account controls must reflect session readiness
   and actual ownership, not just whether a private-looking route was opened.
6. After verification, enable backend `AUTH_MODE=supabase`, provide required
   verification configuration and remove frontend `VITE_AUTH_MODE=disabled`
   for the release build. Keep fake login restricted to development.

No separate auth server, vector store, queue or paid compute instance is needed.
Existing Supabase/Storage quotas still apply; saving introduces persistent PNG
growth that browser-only downloads did not.

## Approved rollout only

This PR does not merge itself, apply production SQL, change cloud credentials or
enable accounts. The Blueprint keeps `AUTH_MODE=disabled`, `GUEST_LIMIT_ENABLED=false`
and `VITE_AUTH_MODE=disabled`; the generated guest signing secret alone grants
no application privileges.

After review and explicit release approval:

1. Apply `data/migrations/0001_auth_operations.sql` once through a trusted Supabase
   SQL connection and record the applied migration. It is additive and transactional.
   Do not run `data/schema.sql` as a migration. Verify RPC/table permissions remain
   service-role-only. Real-auth startup checks that the operation RPC is available.
2. Configure Google and the Supabase redirect allowlist for
   `https://pidsklom-web-bhw6.onrender.com/auth/callback`. Configure public project
   URL/key on the frontend and check the project's actual JWT algorithm; set
   `SUPABASE_JWT_ALGORITHM` accordingly. Only HS256 needs `SUPABASE_JWT_SECRET`.
3. Use a staged/test environment for real Google acceptance with two users before
   turning on production accounts. The automated browser test uses the real SDK
   with loopback fake OAuth endpoints; it does not prove Google-console setup.
4. In a reviewed release configuration, set API `AUTH_MODE=supabase` and
   `GUEST_LIMIT_ENABLED=true`, with a stable private `GUEST_TOKEN_SECRET` of at
   least 32 characters. Set frontend `VITE_AUTH_MODE=supabase`,
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public key only), then rebuild.
   Update Blueprint-managed flag values as part of that approved release so a
   later sync cannot silently disable accounts again. Rehearse the transition:
   backend/frontend deploy independently, and an old frontend lacks guest tokens.
   There may be a short generation interruption while both new configurations
   converge; do not enable only one side and leave it that way.
5. Verify the acceptance list below against the actual hosted URLs, including
   cancelled login, two-user ownership and shared-page deletion. Keep a rollback
   path that disables both account UI and guest enforcement without dropping data.

Do not rotate the guest signing secret on every deployment: rotation invalidates
existing guest credentials. A missing/invalid credential fails explicitly rather
than silently issuing a new allowance. Clearing browser storage is the documented
user-controlled reset bypass.

Operation results and guest usage remain in Postgres across restarts. They retain
request/result data and consume database quota; define retention/compaction before
large-scale use without resetting lifetime guest usage or breaking save retries.
Do not log bearer tokens, OAuth codes or guest credentials.

## Acceptance before enabling accounts

- Guest browsing, manual creation and PNG download work without login; AI flows
  work within the guest allowance.
- A fresh guest can complete exactly three successful requests across phrase
  matching and captions. Batches count once; more-variants requests count again;
  usable fallback counts and failures do not.
- The fourth request is rejected before any provider call. Concurrent requests
  cannot exceed the allowance, and abandoned reservations recover. Browser
  reload and backend restart do not reset recorded usage.
- At the limit, manual editing and download remain available; successful Google
  sign-in unlocks generation. Logout retains the browser's prior guest usage.
- Guest Save survives redirect with all draft fields intact and completes once;
  duplicate callbacks, refresh and a lost-response retry produce one saved meme.
- Cancelled/failed login retains the draft without creating a meme. Failed saves
  show errors and can be retried without duplication.
- Reload restores a valid session before account requests; refresh and logout
  update UI/token state without exposing the previous user's collection.
- Edit/save/reload restores the latest caption and style, not the pre-login
  snapshot. Unsaved changes also survive reload without changing the public meme;
  the next explicit Save updates the existing saved ID.
- Two real users see separate collections and cannot edit/delete each other's
  memes. Invalid/expired tokens cannot perform account operations.
- Shared pages/PNGs remain readable without login, with the public-by-link notice
  shown during saving.
- Confirmed deletion removes the meme and hosted image; cancellation does
  nothing. Storage/database failures remain visible and recoverable.
- Existing-meme edits retain its ID; favourites never delete a meme.
- Sign-in does not grant admin access or start unrelated pending mutations.

Provider setup: [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).
