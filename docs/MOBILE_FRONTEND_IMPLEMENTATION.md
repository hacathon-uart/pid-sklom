# Responsive frontend: implementation sequence

Status: **Implementation baseline complete; release QA pending.** This is the execution
plan for [the product plan](MOBILE_FRONTEND_PLAN.md) and [ADR 0009](adr/0009-one-responsive-frontend.md).
It does not change the agreed product or route contracts.
Progress and remaining gates: [implementation handoff](MOBILE_FRONTEND_HANDOFF.md).

## Remaining delivery roadmap

Assessment baseline: local commit `7745a0f`, reviewed on 2026-11-18.
The responsive foundation is implemented; the following milestones are the
remaining execution order, not a request to repeat Steps 0-5 below.
Current execution evidence is recorded in the handoff: R1-R3 are implemented
and locally verified; R4/R5 have automated/content improvements but retain human
device/visual gates. R6 is blocked; catalogue pagination in R7 is implemented,
while measured mobile performance remains a post-release follow-up.
This plan does not authorize publishing, merging, or deploying.

| Milestone | Priority | Depends on | Deliverable and exit gate |
|---|---|---|---|
| R1. Restore browser regressions | Release blocker | Existing baseline | Update obsolete control selectors and assertions in `scripts/check_auth_browser.mjs`; the complete checked-in runner passes without weakening draft, account, Save, share, or export assertions. |
| R2. Complete loading/error feedback | Release requirement | Existing baseline | Explicit story loading/ready/unavailable/error states with retry for recoverable failures; visible picker preselection errors; focused delayed/failing-response tests pass. |
| R3. Make mobile coverage durable | Release requirement | R1, R2 | Complete critical journeys and export variants have deterministic browser coverage; the mobile suite runs in the existing frontend CI job against isolated fixtures. |
| R4. Validate access and native interaction | Release requirement | R3 | Keyboard, real text enlargement, iOS Safari and Android Chrome acceptance evidence is recorded; any fixes rerun the affected automated checks. |
| R5. Focused visual/content polish | Release requirement | Existing baseline | Reviewed phone/desktop reference pairs, readable action hierarchy and shared states, verified public links; changes pass R3 and R4 before release. |
| R6. Release checkpoint | Release gate | R1, R2, R3, R4, R5 | Required CI passes for the final candidate; authorized release and production smoke checks confirm the intended frontend revision. |
| R7. Measured follow-ups | After release | R6 | Catalogue pagination is implemented; profile mobile loading before optimization and reassess the 20-artwork page size with the full collection. |

R1, R2, and reference review for R5 can proceed independently. Complete R3
against the resulting behavior, then test that candidate on devices in R4.
Any later functional or visual change invalidates the affected acceptance
evidence; do not treat an earlier device pass as approval of a different build.

### R1 - restore the existing behavioral safety net

- Start with `node scripts/check_auth_browser.mjs` from the repository root.
  The assessment reproduced a failure at line 394: the runner expects
  `radiogroup`/`radio`/`aria-checked`, while `FramePicker` now exposes a labelled
  group of toggle buttons using `aria-pressed`.
- Update all affected frame and share-control lookups to current accessible
  names and state. Keep assertions about the selected frame and persisted
  draft values; do not merely remove failing assertions or revert accessible
  controls to satisfy obsolete selectors. Update the color lookup to the
  current accessible label and assert that it actually finds a selection.
- In-memory diagnostic adaptations passed direct-entry draft restoration,
  artwork-scoped drafts, and signed-in Save checks, then stopped at another
  missing-control lookup. This is partial diagnostic evidence, not a suite
  pass. Resolve remaining failures and run the complete checked-in runner
  without in-memory adaptations.
- Add bounded readiness waits where lazy-loaded routes make timing relevant.
  A failing or missing control must produce an explicit test failure.

### R2 - make asynchronous states truthful

- Let route modules own story request state and pass a small explicit state
  interface into `MemeWorkspace`. Do not show "unavailable" while a selected
  alternative's story is still loading. Preserve story and source access
  after retries; an older response must not replace the current artwork.
- Replace `ChoosePaintingPage`'s swallowed preselection rejection with a
  recoverable message. Verify failed deep links, retry, dismissal, and a
  manual selection made while preselection/random requests are pending.
- Extract the selected-artwork panel when changing its sizing or feedback
  behavior if that improves locality. Keep fetching and selection ownership
  in the route; do not make a cosmetic extraction a release blocker.

### R3 - expand coverage and integrate it once

- Cover phrase -> edit -> Save/export, painting -> AI and own caption,
  gallery -> artist -> create, saved edit, and signed-out public `/m/:id`.
  Complete all three quiz games through certificate; verify signed-in
  record persistence and the guest stopping condition.
- Exercise guest generation/export exhaustion independently, unchanged PNG
  replay after exhaustion, OAuth return to the same draft, cancelled sharing,
  and auth-disabled navigation. Existing desktop account tests remain part
  of the safety net, not proof that the phone presentation works.
- Add 375/430 px to the durable width matrix. Check long Ukrainian labels,
  loading/empty/error states, portrait/landscape artwork, two caption blocks,
  supported fonts, frame options, resize, and editor-open PNG identity.
  Compare unchanged exports across desktop and phone within the same browser;
  do not require byte identity between different browser engines.
- Replace fixed sleeps with bounded assertions on route, content, image/font
  readiness and operation completion. Capture browser errors and useful
  failure evidence. Check both document overflow and controls clipped inside
  fixed surfaces.
- Extend the existing browser/CDP tooling where practical. Run against
  isolated local fixtures with explicit stub settings and Telegram disabled;
  a loopback frontend URL alone does not prove its backend is offline.
  CI must start, check readiness of, and clean up its own processes.

### R4 - distinguish emulation from device acceptance

- The existing root-font-size probe is only a navigation containment check.
  In the assessment, doubling the root size left the tested heading at 43 px.
  Verify that representative text actually enlarges before calling a test
  "200% text"; also check browser zoom/reflow separately.
- Check keyboard-only completion, visible and unobscured focus, dialog focus
  return, visual versus DOM order in the quiz lobby, non-drag editing,
  reduced motion, contrast and main touch targets.
- On real iOS Safari and Android Chrome, test caption drag versus page scroll,
  virtual keyboard and picker-panel actions, safe areas, orientation changes,
  PNG download, native share/cancel/retry and clipboard denial. Include a
  public link opened from Telegram's in-app browser when available.
- Record device/browser, candidate revision, journey and result. This requires
  device access or a human tester; headless Chrome is not a substitute.
- Current automation: `node scripts/check_accessibility_browser.mjs` measures
  actual representative text growth before checking reflow, and traverses the
  creation/editor/selected-picker/quiz routes with real keyboard events.
  Shared typography and rail sizing now use relative units without changing
  their default 16 px-root dimensions. This is not a complete WCAG audit.

### R5-R7 - polish, release, and avoid premature scaling work

- Review a small 390 px reference set for home, selected picker, editor/story
  and quiz/certificate beside desktop counterparts. Include 320 px and long
  content/error examples; expand references where those reviews expose gaps.
  Keep the existing museum identity rather than starting a new visual system.
- Correct the homepage's stale bot handle and placeholder project links.
  Verify link targets and preserve the bot's restricted-access messaging.
- Before release, run the final width/state/journey matrix and required CI.
  Keep granular commits, validate locally per slice, and push coherent batches
  rather than triggering CI after every commit. Publishing and deployment
  require separate authorization; afterward verify revision, deep links,
  static assets, navigation, public view and export without unnecessary
  production writes or AI spend.
- After release, measure loading on a representative phone and connection.
  The baseline main chunk is about 564 kB (166 kB gzip), and the editor chunk
  is about 348 kB (107 kB gzip). Optimize the measured bottleneck, not just
  the warning threshold. Measure search latency before adding debounce; the
  gallery and picker now use 20-artwork pages.

### Design skill usage

`ui-ux-pro-max` is already installed project-locally under
`.agents/skills/ui-ux-pro-max` from
`https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git`; its provenance
and upstream license are documented in `.agents/skills/README.md`.
The skills CLI recognizes it for GitHub Copilot. Use targeted accessibility,
touch and React/Tailwind guidance for these milestones. Existing Figma,
`frontend/src/styles/tokens.css`, and ADR 0009 remain authoritative; skill
recommendations do not authorize a replacement palette, route tree or draft
model. Skill availability in an already-running agent session may differ from
on-disk discovery.

## Rules for the implementation

- Keep one React route tree, one set of flow state, and one editor/export path.
  The viewport changes presentation, not API calls, draft shape, quiz scoring,
  guest limits, or permissions.
- Use the desktop Figma and `frontend/src/styles/tokens.css` as the visual source
  of truth. Keep the existing paper, frames, artwork, typography, and hall colors.
  Add a token when a value is reused or has a clear semantic purpose; do not
  regenerate the product palette from the installed skill's examples.
- Start with content order and intrinsic sizing, then add mobile-first layout
  rules. Use CSS for reflow. Use viewport state in React only if an interaction
  truly differs; keep the same data and callbacks behind both presentations.
- Every fixed or sticky surface must have one owner and an explicit clearance
  rule. `Layout` owns navigation space; the painting picker owns its selected
  panel. Avoid page-specific guesses about the sidebar or bottom bar height.
- Keep touch and keyboard paths equivalent. Captions need preset position
  controls even when direct dragging works; the quiz pair game needs taps.

## Step 0 — mobile reference and baseline

**Output:** A small reference set in `docs/design/` showing 390 px layouts for
home, painting picker with selection, result/editor with StoryCard, gallery,
account, quiz lobby, question, pair matching, and certificate. Annotate content
order and actions. Check each at 320 px and at a tablet transition; compare
against the desktop Figma. Add loading, empty, error, long Ukrainian text, and
guest allowance examples where they change the layout.

Record current screenshots at 320, 390, 768, and 1440 CSS px before changing
styles. Note actual overflow and obscured controls. Decide the exact mobile nav
labels and whether five tabs remain legible at 320 px with enlarged text. The
mobile frames settle this; avoid locking the layout to a device brand or one
phone width.

**Gate:** The reference shows a readable primary action and a route back on
each deep screen. The team can point to the phone and desktop versions of each
critical flow. This step can be a documentation commit.

## Step 1 — foundation: shared tokens and shell

**Files:** `frontend/src/styles/tokens.css`, `frontend/src/index.css`,
`frontend/src/components/Layout.tsx`, `Sidebar.tsx`, `Button.tsx`, `Input.tsx`,
`Tag.tsx`, `ModeSwitch.tsx`, `Museum.tsx`, and auth notices/popovers.

1. Define only the needed layout tokens, for example content gutter, phone nav
   height, and bottom safe-area clearance. Treat the existing color and font
   tokens as semantic values; add component tokens only where multiple states
   need the same rule. Make type scale and page gutters fit the phone without
   shrinking body copy to solve overflow. Start with a compact shell below
   768 CSS px, then verify both sides of that threshold and let individual
   content grids reflow when their contents fit.
2. Give primary navigation one shared item definition for rail and phone bar.
   Put active state, label, icon, and auth-disabled behavior in that definition.
   Under the chosen compact breakpoint, render the labelled bottom bar; keep
   the desktop rail at larger widths. `Layout` reserves space for whichever
   navigation is visible. Deep links and browser Back keep working.
3. Make `Page` handle responsive gutters, title/subtitle wrapping, header action
   order, and long titles. Normalize form controls and buttons for width,
   wrapping, focus, disabled/loading states, and comfortable tap targets.
   Make `Wall` use the same gutter token: its current `-mx-16 px-16` assumes
   the desktop `Page` padding and would break once that padding changes.
4. Contain guest ticket and auth prompts inside the viewport. Opening and
   closing them must preserve focus and leave the triggering control visible.
   Give fixed navigation enough scroll padding so focused controls are visible.
   Include the auth notice offset in `auth/AuthContext.tsx`; it currently
   assumes the desktop sidebar.

**Gate:** Every route is reachable at 320–430 px. The bottom bar and guest
ticket do not clip, overlap focused controls, or cause horizontal page scroll.
Desktop rail and page header still match their prior layout. Commit shell and
shared primitive changes before page-specific work.

## Step 2 — entry and painting selection

**Files:** `HomePage.tsx`, `CreatePhrasePage.tsx`,
`ChoosePaintingPage.tsx`, `components/cards.tsx`, and shared form components.

1. Put the home phrase form above decorative content; stack input and action.
   Reflow the two painting paths, About cards, and footer. Keep the same copy and
   three creation paths. Move the absolutely positioned account controls into
   the phone reading flow and give the home screen a main landmark.
2. Stack the phrase entry fields and make the mode switch fit short and long
   labels. Ensure the primary action remains close to its input.
3. Give catalogue search a full row and let genre filters wrap or scroll with
   visible affordance. Use responsive artwork cards with enough room for title,
   artist, and a real selection target. Keep random selection near search.
4. Extract the selected artwork action panel as a presentation component fed
   by the existing `selected` state and callbacks. On phones it is a contained
   panel above navigation with an explicit close/reset control; on desktop it
   keeps its present role. Both AI and own-caption actions remain clear, with
   the URL mode deciding only which is primary. The panel's height and scroll
   clearance must accommodate wrapped text and the virtual keyboard.
   Handle slow random/preselection requests so an older response cannot replace
   the visitor's newer selection; show busy/error feedback for random selection.

**Gate:** Phrase, painting-to-AI, painting-to-own, random, search/filter,
preselected `?artwork=`, and selection reset work by touch and keyboard. The
selected panel does not cover the last artwork card or navigation. Commit home
and creation entry separately from picker/panel if review size grows.

## Step 3 — result, editor, story, and export

**Files:** `editor/MemeWorkspace.tsx`, `MemeCanvas.tsx`,
`CaptionControls.tsx`, `FramePicker.tsx`, `useMemeEditor.ts`,
`useMemeDraft.ts`, `useMemeExport.ts`, `pages/PhraseResultPage.tsx`,
`AiCaptionsPage.tsx`, `OwnCaptionPage.tsx`, `EditMemePage.tsx`, and `StoryCard.tsx`.

1. Reflow the shared workspace to one column on phones: art preview, key
   actions, caption controls, and reviewed story. Give the story a visible
   link/anchor near the preview. Wrap the toolbar instead of squeezing icon
   buttons or hiding actions. Keep loading and export feedback near the action.
2. Keep `MemeCanvas` as the only preview and PNG renderer. Check its
   `ResizeObserver` sizing, portrait/landscape art, caption hit areas, drag
   bounds, and behavior while the page scrolls. Today `draggable` is always on
   and drag bounds clamp only the caption origin, so gate dragging on editing
   and keep the whole caption box within the art. Add a visible edit action so
   the caption is not discoverable only by tapping text on the canvas.
3. Use the existing draft setters for preset top/middle/bottom positions and
   text fields. Any finer placement controls must update the same normalized
   coordinates as dragging. A user must be able to complete an edit with taps
   or keyboard alone. Keep one active caption and one draft when the viewport
   changes or an auth return resumes the flow.
4. Preserve save, guest export accounting, download, native share fallback,
   frame inclusion, and the watermark. Avoid separate phone export logic.
   Export from canonical dimensions: the current minimum outline width and
   active-caption shadow can produce different pixels at different viewport
   widths or while editing. This matters because guest export accounting uses
   the image fingerprint. Test unchanged drafts for pixel-identical output
   across widths and editing states. Distinguish story loading, absent story,
   and fetch failure instead of a persistent skeleton.

**Gate:** At phone and desktop widths, the same draft produces the same PNG;
caption text/position/frame survive resize and sign-in return. Touch scrolling
and caption dragging do not fight; keyboard/tap controls can achieve the same
result. Story and source links remain reachable. Verify iOS Safari and Android
Chrome manually for gesture, download, and share behavior. Treat export pixel
identity and one guest charge for an unchanged draft as release blockers.

## Step 4 — discovery, account, and public links

**Files:** `GalleryPage.tsx`, `ArtistsPage.tsx`, `ArtistPage.tsx`,
`MyMemesPage.tsx`, `MemeViewPage.tsx`, `components/cards.tsx`,
`Portrait.tsx`, `StoryCard.tsx`, and account dialogs.

1. Reflow search, filters, artwork grids, and artist portraits based on card
   content rather than a fixed five/six column count. Keep author navigation
   visible and operable without swipe. The current carousel also slices the
   data to six authors; a phone row must make the whole list reachable, not
   merely reduce the six-column grid. Check `Portrait` and `Artwork` sizing.
2. Stack artist biography, artwork, and story while preserving the page's
   catalogue identity. Bring the bespoke `ArtistPage` container under shared
   page gutter rules.
3. Reflow saved meme cards, account actions, and public `/m/:id` view. Give
   share and edit actions room, and ensure the public view works signed out.
   Destructive confirmations need readable text, visible cancel, and focus
   return. Keep link sharing separate from charged PNG export, and show a
   recoverable inline error if clipboard access fails. Prevent rapid favorite
   or frame changes from racing slower responses.

**Gate:** Gallery → artist → create, saved meme → edit, and public share link
work at 320–430 px with long Ukrainian labels and either art orientation.
Search, empty states, and account prompts fit without overlap.

## Step 5 — quiz interactions

**Files:** `QuizPage.tsx`, `QuizPlayPage.tsx`, `quiz/Museum.tsx`,
`quiz/Certificate.tsx`, and related quiz styles.

1. Present each hall as a large labelled card on phones using the same game
   data/callbacks as the floor plan. Keep the floor plan as visual context,
   rather than shrinking SVG interaction targets.
2. Place question artwork before answers; allow long answer text and feedback
   stamps to wrap. Remove the permanent `pr-36` answer-text reservation on
   phones; it consumes most of a narrow card before any stamp appears. Make
   loading/advance states and revealed facts visible.
3. Give pair matching a tap-to-select then tap-to-match path using the existing
   scoring state. It must be usable without drawing a line or dragging across
   columns. Freeze assignment controls during submission so the displayed
   pairs cannot diverge from the submitted answer. Keep selection and
   correctness readable without relying on color.
4. Recompose the certificate as one readable column, with score, rank, date,
   and next action clear of ornament. Reflow record rows with long ranks rather
   than preserving their current no-wrap rule. Preserve guest cap and account
   records.

**Gate:** All three games complete as guest and signed-in visitor at phone
widths. Focus order, Back behavior, long answers, result/certificate, and
record persistence work; desktop quiz remains intact.

## Step 6 — release quality pass

- **Widths:** 320, 375, 390, 430, 768, 1024, 1440 CSS px; check 200% text,
  portrait/landscape, and long Ukrainian content. Whole-page horizontal scroll
  should be absent. Inspect any intentionally scrollable chip row separately.
- **States:** loading, empty, network failure/retry, unauthenticated, auth
  disabled, guest allowance exhausted, reduced motion, and permission dialogs.
- **Access:** keyboard order, visible focus, meaningful labels, contrast,
  tap targets, no essential hover-only controls, and no fixed surface obscuring
  focused content. Aim for 44 CSS px on main touch actions; the WCAG 2.2 AA
  target-size rule has a 24 CSS px minimum with specified exceptions.
- **Journeys:** run the full creation, editor/export, gallery/account/public
  link, and three quiz games on real iOS Safari and Android Chrome as well as
  desktop Chrome. Check virtual keyboard, safe area, native share, and downloads.
- **Automation:** `frontend/scripts/mobile-smoke.mjs` checks representative
  route widths, navigation, painting selection, initial quiz answers, and
  unchanged-export identity. Extend it for draft preservation and full
  journeys before the release gate. Run `typecheck`/`build` for each slice.
  Do not treat build success as proof of mobile interaction quality.

Commit each step or coherent substep independently. Review one phone screen and
its desktop counterpart together. Release the responsive frontend only after
the whole route set and all three quiz games pass the matrix.

## Component ownership and dependency order

| Owner | Responsibility | Depends on |
|---|---|---|
| `Layout` / `Page` | Navigation placement, page gutters, content/focus clearance | Existing route tree and token values |
| Route pages | Fetching, flow transitions, loading/error state, page content order | Shared shell and domain hooks |
| Picker panel | Selection presentation and dismissal | Picker's `selected` state and callbacks |
| `MemeWorkspace` | Preview/actions/story composition | Existing draft and export hooks |
| `MemeCanvas` | Pointer behavior and exact preview/export image | Normalized caption model |
| Quiz presentations | Hall selection, answer and pair controls | Existing quiz game/scoring state |

The dependency path is **mobile reference → shell → entry/picker → editor →
discovery/account → quiz → full quality pass**. Discovery and quiz can be built
in parallel after the shared shell is stable; neither should introduce a second
navigation or token system.
