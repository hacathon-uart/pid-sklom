# Responsive frontend: implementation sequence

Status: **Ready to implement on `herman/mobile-front`**. This is the execution
plan for [the product plan](MOBILE_FRONTEND_PLAN.md) and [ADR 0009](adr/0009-one-responsive-frontend.md).
It does not change the agreed product or route contracts.

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
- **Automation:** add a small browser smoke harness for route navigation,
  overflow, draft preservation, and unchanged-export identity before the
  release gate. The current frontend has only `typecheck`/`build`; run both
  for each implementation slice. Do not treat build success as proof of
  mobile interaction quality.

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
