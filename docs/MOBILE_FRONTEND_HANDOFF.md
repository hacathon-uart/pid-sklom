# Responsive frontend handoff

Status: **Responsive hardening implemented locally on `herman/mobile-front`; automated gates passing; device/visual acceptance and release pending.**
Base: `origin/main` at `45f1730`. Product scope and route contract are in
[the mobile plan](MOBILE_FRONTEND_PLAN.md) and [ADR 0009](adr/0009-one-responsive-frontend.md).
The remaining delivery order and acceptance gates are in the
[release roadmap](MOBILE_FRONTEND_IMPLEMENTATION.md#remaining-delivery-roadmap).
The same document retains the original implementation sequence for context.

## Roadmap execution (2026-11-19, locally committed candidate after `7745a0f`)

| Milestone | Current evidence |
|---|---|
| R1 | Full account/draft/Save/share/export runner passes at its default desktop viewport and at `BROWSER_WIDTH=390`. Frame/color assertions use current accessible names and pressed states, without removing behavioral checks. Builds no longer load `.env` files or overwrite a shared `dist`. |
| R2 | Explicit story loading/ready/unavailable/error states, retry, preserved source links/drafts and epoch-protected responses. Picker preselection failures are visible, retryable and dismissible. Held-response tests cover A -> B -> A, stale success/failure/retry, manual selection versus preselection/random, and invalid links. |
| R3 | Self-owned mobile runner covers 14 routes at 320/375/390/430/768/1024/1440 px, catalogue empty/error/retry, painting -> own, gallery -> artist -> AI, public view, all guest/member quiz runs through certificate and restored member records. Desktop and phone account runners retain allowance exhaustion/replay, OAuth, saved-edit and cancelled-share coverage. All runners are wired into the frontend CI job; hosted CI has not been triggered for this local candidate. |
| R4 | Automated representative text actually doubles; narrow reflow, real keyboard traversal/focus, skip link, selected-picker obstruction, guest-ticket Escape/focus return, non-drag presets and reduced motion pass. This exposed and fixed real heading/ticket/story/preset overflow, an unfocusable skip target, decorative SVG clone tab stops and selected-panel focus obstruction. Real devices, real browser zoom, screen readers and final contrast/visual acceptance remain open. |
| R5 | Footer now links the verified production bot page (with restricted-access copy), repository and gallery instead of stale/placeholder items. Content-sized caption presets avoid unnecessary word splitting, and the certificate reserves space so its decorative stamp does not cover copy. Twenty-five local fixture reference screenshots cover home, selected picker, editor/controls/story, errors and certificates at 320/390/1440 px. They are geometry references, not final production-art/font approval. |
| R6 | Implementation recorded in granular local commits. Release remains blocked on the human gates below, final hosted CI and explicit publishing/deployment authorization. No push, merge, production API call or deployment was performed. |
| R7 | Deliberately deferred until release/profile evidence; the existing 50-artwork catalogue limit is unchanged. |

The mobile harness intercepts external font CSS and supplies the existing bundled
Oswald font. Other named font controls are exercised with browser fallbacks:
PNG identity is verified within that engine, **not** real production glyph rendering
for every font. UI font metrics and production artwork must still be reviewed.
Fixture API responses test frontend behavior; they do not replace backend contract
tests or live-provider acceptance. Local screenshots stay in session artifacts,
not the repository.

## What landed

| Area | Implemented | Commits |
|---|---|---|
| Shell and controls | One destination list for desktop rail and phone bottom navigation, safe-area clearance, responsive page gutters/headings, skip link, contained guest panel, focus and touch sizing | `d73e98d` |
| Creation entry | Home and phrase forms reflow; painting search/filter/grid and selected artwork panel fit narrow screens; stale preselection/random responses cannot replace a newer choice | `a2dd58f` |
| Result and editor | Shared workspace stacks art, labelled actions, controls, and story; caption controls wrap; fixed internal Konva stage keeps export pixels independent of viewport width; dragging is edit-only and bounded | `1b14ccf` |
| Discovery/account | Responsive gallery, authors, artist page, saved/public meme views, readable actions, inline share feedback, and mutation guards | `a36734e` |
| Quiz | Phone hall cards, answer reflow, tap-based pairs, responsive certificate; hall action precedes decorative plan on phones | `4fa1eb1`, `3f41a7b` |
| Delivery quality | Lazy-loaded route screens, a reusable browser smoke check, tablet quiz and gallery overflow fixes, enlarged-text navigation containment | `6c6d9c9`, `e3a53ad` |

The existing API, draft model, scoring, account rules, and URL paths remain shared
between desktop and phone. Mobile presentation is handled by CSS and small
view components. The desktop visual system remains anchored to
`frontend/src/styles/tokens.css` and the [design reference](design/README.md).

## Baseline verification (before hardening)

- `npm run build` passes, including TypeScript. Vite reports an initial JS
  bundle of 564 kB (166 kB gzip), down from about 994 kB (294 kB gzip)
  before route splitting. The editor's shared chunk is 348 kB (107 kB gzip)
  and loads on an editor route.
- `SMOKE_EXPORT=1 SMOKE_FLOWS=1 npm run smoke:mobile` passes against the offline
  stub API and local headless Chrome. It checks nine routes at 320, 390, 768,
  1024, and 1440 CSS px for page overflow, headings, and active navigation.
  It also selects a painting, submits one answer in each quiz game, and
  compares PNG bytes at 390 px, 320 px, and with the editor open.
- Manual screenshots were inspected for phone home, phrase creation, painting
  picker and selected panel, result/editor, gallery, artist, account entry,
  quiz lobby, and question. The smoke check found and helped fix a 768 px quiz
  overflow and a 1024 px gallery arrow overflow.
- A 320 px check with doubled root text size keeps the page within the viewport;
  the bottom navigation becomes internally scrollable so labels stay readable.
  This is not proof of 200% text support: an assessment probe doubled the root
  font size but left the tested heading unchanged at 43 px.

### Independent assessment of `7745a0f` (2026-11-18)

- Reproduced the production build and full available mobile smoke pass using
  isolated loopback stub services; no production credentials or services were
  used.
- Additional 375/430 px checks found no document overflow on own-caption,
  AI-caption, artist, signed-out account entry and title-quiz screens.
  These checks are not yet part of the durable smoke runner.
- **Release blocker:** `node scripts/check_auth_browser.mjs`, used by the
  existing frontend CI job, fails at line 394 on an obsolete frame-control
  selector. The implementation uses a labelled group with `aria-pressed`,
  while the runner expects radio semantics. In-memory diagnostic adaptations
  passed draft/Save checks but later hit another missing-control selector;
  the full suite has not passed. No repository test or application files were
  changed during that assessment.
- The new mobile smoke command is not yet invoked by CI. Passing it locally
  does not replace the existing account/draft/export regression suite.

The smoke check covers **one quiz answer per game**, not a complete run. The
PNG comparison covers one stub composition. These checks establish layout and
export invariants for those cases, not device compatibility or full release
readiness.

### Reproduce locally

Install frontend dependencies as described in the README, then run from the root:

```bash
npm --prefix frontend run typecheck
node scripts/check_auth_browser.mjs
BROWSER_WIDTH=390 node scripts/check_auth_browser.mjs
node scripts/check_story_browser.mjs
node scripts/check_accessibility_browser.mjs
npm --prefix frontend run smoke:mobile
```

Each browser command owns its loopback fixtures, private Chrome profile, ephemeral
debug port, environment-file-free production build and cleanup. No backend,
Telegram token, configured Supabase project or prestarted Chrome is needed.
`CHROME_PATH` overrides Chrome discovery. `smoke:mobile` now always runs its flows
and PNG checks; the former `SMOKE_FLOWS`/`SMOKE_EXPORT` opt-ins and externally
started servers are no longer used. Set `SMOKE_SCREENSHOT_DIR` to an explicit
local artifact directory to capture the reference set (do not commit fixture
screenshots as production design approval).

## Assessment and remaining work

| Priority | Status | Work and release evidence needed |
|---|---|---|
| Regression gate | **Passing locally** | Complete desktop and 390 px account/draft/Save/share/export runners; isolated story-race and accessibility checks; expanded mobile journeys. Hosted CI must still run on the final published candidate. |
| Release gate | **TBD** | Test real iOS Safari and Android Chrome: caption drag versus page scroll, virtual keyboard, bottom safe areas, selected-artwork panel, PNG download, native share/cancel/retry, clipboard denial, and orientation changes. Headless Chrome cannot establish these outcomes. |
| Release gate | **Automated locally; human pending** | Critical journeys now run against deterministic fixtures, including full quizzes, allowances, OAuth, saved/public views and auth-disabled navigation. Repeat native interactions and real provider/content acceptance on the final candidate without unnecessary AI spend or production writes. |
| Design gate | **Partial** | Review generated phone/desktop reference pairs with production artwork and loaded UI/meme fonts; approve long text, story, certificate and error states. No mobile Figma frames or designer approval are implied by fixture screenshots. |
| Accessibility gate | **Partial** | Automated 200% representative text, effective narrow-viewport reflow and keyboard checks pass. Check actual browser zoom/text settings, screen readers, contrast and focus with native overlays on real devices. |
| Follow-up | **TBD** | Gallery and picker still request at most 50 artworks. Decide pagination/search behavior when the approved catalogue exceeds that limit. This predates the mobile change. |
| Follow-up | **TBD** | Measure mobile loading on a representative device. Route splitting reduced the initial JS, but the main bundle remains 564 kB and the editor chunk 348 kB. Optimize based on measured delay. |

There is no data migration or backend change in this branch. The branch has not
been pushed or deployed. The prior attempt to publish this local branch was
rejected by automatic approval review, so publishing remains a separate step
requiring explicit authorization.

## Suggested next work order

R1-R3 are implemented and locally verified. Finish R4/R5 with real-device,
production-font/artwork and visual acceptance; fix any findings and rerun affected
checks. Then obtain explicit authorization for R6 publication/CI/merge/deployment.
Measured performance and catalogue-growth work remain R7, after the release.
