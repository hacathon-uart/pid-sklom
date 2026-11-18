# Responsive frontend handoff

Status: **Implementation baseline complete on local branch `herman/mobile-front`; release QA pending.**
Base: `origin/main` at `45f1730`. Product scope and route contract are in
[the mobile plan](MOBILE_FRONTEND_PLAN.md) and [ADR 0009](adr/0009-one-responsive-frontend.md).
The detailed work sequence is in [the implementation plan](MOBILE_FRONTEND_IMPLEMENTATION.md).

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

## Verification completed

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

The smoke check covers **one quiz answer per game**, not a complete run. The
PNG comparison covers one stub composition. These checks establish layout and
export invariants for those cases, not device compatibility or full release
readiness.

### Reproduce locally

Use the offline backend setup in the root README. With its virtual environment
ready, run these in separate terminals:

```bash
cd backend
DATA_BACKEND=local AI_PROVIDER=stub AUTH_MODE=stub TELEGRAM_BOT_TOKEN= \
  FRONTEND_ORIGINS=http://127.0.0.1:5173 \
  .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

```bash
cd frontend
VITE_API_URL=http://127.0.0.1:8001 npm run dev -- --host 127.0.0.1
```

```bash
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --headless=new --remote-debugging-port=9222 --remote-allow-origins='*' \
  --user-data-dir=/tmp/pidsklom-smoke about:blank
```

```bash
cd frontend
SMOKE_EXPORT=1 SMOKE_FLOWS=1 npm run smoke:mobile
```

Run the smoke command only against the offline stub API: even the default route
checks start quiz and meme-generation requests. The Chrome DevTools port is for
local development only.

## Assessment and remaining work

| Priority | Status | Work and release evidence needed |
|---|---|---|
| Release gate | **TBD** | Test real iOS Safari and Android Chrome: caption drag versus page scroll, virtual keyboard, bottom safe areas, selected-artwork panel, PNG download, native share/cancel/retry, clipboard denial, and orientation changes. Headless Chrome cannot establish these outcomes. |
| Release gate | **TBD** | Run full phrase → edit → save/export, painting → AI and own caption, gallery → artist → create, saved/public meme, and all three quiz games through certificate as guest and signed-in visitor. Verify guest allowance exhaustion, OAuth return to draft, record persistence, and auth-disabled navigation with production-like configuration. |
| Design gate | **TBD** | Create/review the 390 px mobile reference frames from Step 0, including 320 px edge cases, long Ukrainian text, empty/error/loading states, and the 200% text presentation. No mobile Figma frames were produced in this coding pass. |
| Important | **Partial** | The smoke suite checks representative route widths and one PNG. Add cases for 375/430 px, portrait/landscape artwork, two caption blocks, font variants, the public `/m/:id` view, saved edit, and full quiz completion. Exercise the picker with the virtual keyboard and a very long selected title. |
| Important | **Partial** | `MemeWorkspace` now shows an unavailable-story message for `null`, but the route contract does not distinguish loading, absent story, and fetch failure. Make the story state explicit so slow requests do not show a premature failure. |
| Important | **TBD** | Extract the selected-artwork panel from `ChoosePaintingPage` into a small presentation component. The page currently owns fetching, race handling, panel measurement, and panel markup; this is the main remaining SOLID seam. |
| Follow-up | **TBD** | Gallery and picker still request at most 50 artworks. Decide pagination/search behavior when the approved catalogue exceeds that limit. This predates the mobile change. |
| Follow-up | **TBD** | Measure mobile loading on a representative device. Route splitting reduced the initial JS, but the main bundle remains 564 kB and the editor chunk 348 kB. Optimize based on measured delay. |

There is no data migration or backend change in this branch. The branch has not
been pushed or deployed. The prior attempt to publish this local branch was
rejected by automatic approval review, so publishing remains a separate step
requiring explicit authorization.

## Suggested next work order

1. Finish the design reference frames and review them beside the current phone
   screenshots and desktop Figma.
2. Run the real-device and account/guest journeys above; fix any failures in
   small commits.
3. Make story state explicit and extract the picker panel, then expand smoke
   coverage around those seams.
4. Run the full release matrix from the implementation plan and review the
   desktop counterpart of every changed screen before publishing the branch.
