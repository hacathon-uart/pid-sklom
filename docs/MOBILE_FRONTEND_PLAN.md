# Mobile frontend: product and delivery plan

Status: **Responsive implementation merged and deployed; device and visual QA pending.**
Decision: [ADR 0009](adr/0009-one-responsive-frontend.md).
Desktop visual reference: [design README and Figma](design/README.md).
Execution sequence: [responsive frontend implementation](MOBILE_FRONTEND_IMPLEMENTATION.md).
Current state: [implementation handoff](MOBILE_FRONTEND_HANDOFF.md).
Next delivery milestones and release gates:
[remaining roadmap](MOBILE_FRONTEND_IMPLEMENTATION.md#remaining-delivery-roadmap).

## Product outcome

A visitor on a phone can discover Ukrainian art, make and export a meme, read its
reviewed story, play a quiz, and return to saved work without zooming or horizontal
page scrolling. The experience should feel like the same museum as the desktop site:
warm paper, framed paintings, small catalogue details, and a clear route from art to
story. The phone layout should give the artwork and the next action room to breathe.

This is responsive web, not a second frontend. Preserve current URLs, auth and guest
allowance behavior, published catalogue rules, draft recovery, and quiz scoring.
No backend migration is planned. The plan covers all current routes, including the
new quiz and the public `/m/:id` share view.

The Telegram bot is another entry to the same published catalogue and creation
services. This work changes the browser presentation only. A link opened from a
Telegram conversation should land on a usable phone page, while bot permissions,
messages and rendering remain governed by the bot's existing decisions.

## Pre-implementation baseline and risks

This table describes the starting point before the responsive implementation,
not the current branch. Use the handoff and remaining roadmap above for current
status and unresolved release work.

| Area | Evidence in code | Mobile consequence |
|---|---|---|
| Shell | `Layout` reserves 88 px for a fixed `Sidebar`; `Page` adds 64 px gutters | Little usable width on phones; no phone navigation |
| Design | Desktop Figma only, 1440 px; token file is shared | Need a mobile design pass using the existing visual language |
| Creation | Home form is horizontal; creation pages use fixed two column layouts | Inputs and primary actions compress or move below decorative art |
| Catalogue | Picker and gallery use five column grids; author carousel uses six; gallery search is 400 px | Tiny artwork targets, clipped controls and hard to scan labels |
| Selection | Picker has a fixed bottom bar, below the catalogue | Collides with mobile navigation and keyboard; three actions compete |
| Results | `MemeWorkspace` and saved meme view use equal two column layouts | Meme, controls and story compete for width; story risks being buried |
| Editor | Konva canvas scales with its container; caption dragging exists; touch verification and resize handles remain TODO | Need direct touch QA and a usable non-drag position control; no mobile-only draft model |
| Guest/account | Ticket popover is 320 px with viewport math; auth notice offsets by sidebar width | Popover and notice can leave the viewport |
| Quiz | Lobby has a floor-plan SVG; play uses two columns, three pair columns, long answer cards and an ornate certificate | SVG targets shrink; pair interaction and long answers need mobile controls |
| Export/share | Web Share API and PNG download already exist | Verify browser behavior and keep the same guest export accounting |

The current `index.html` already sets the viewport meta tag. `index.css` has no
viewport layout queries; the responsive work therefore starts in the shell and
page layouts, not in new product services.

## Mobile experience map

**Navigation.** At phone widths, show a bottom bar with the current primary
destinations: Головна, Створити, Галерея, Вікторина, and Профіль when accounts are
enabled. Keep active state and labels visible. At narrow widths, fit all targets
without clipping or horizontal scrolling; validate the Ukrainian labels at 320 px.
When auth is disabled, omit Профіль as on desktop. The bar sits above the safe area;
content and fixed actions reserve its height. A deep page keeps an explicit back
link or breadcrumb to its parent flow. Desktop retains the rail.

**Home `/`.** Keep the logo, tagline and phrase form as the first useful content.
Stack the input and primary button, then show the two painting-led paths as cards.
Move long About content below the entry paths. Keep the same copy, art direction
and three ways to create; never make a decorative preview block delay the form.

**Phrase and painting entry `/create`, `/create/painting`.** Stack form fields;
put the required phrase before the decorative placeholder. Make the mode switch
fit as two equal selectable options. In the catalogue, search gets a full row,
genre choices remain accessible by wrapping or a deliberate horizontal list, and
artwork cards use two columns on common phones, one at the 320 px edge if labels
need it. Keep the random action near search. The selected artwork opens a compact
bottom action panel above navigation with the image/title and one clear primary
action; both AI and own-caption paths remain reachable. Dismissal is explicit.

**Result and editor `/create/result`, `/create/painting/:id/*`, `/me/memes/:id/edit`.**
Use a single column: painting, export/save actions, caption controls, then the
reviewed StoryCard. Keep a visible route to the story near the painting so it is
not lost below long controls. Editing starts from a clear edit action as well as
tapping the caption. The preview stays visible while editing where space permits;
avoid a second scroll container that traps the user. Preserve selection, text,
frame and draft across viewport changes and sign-in. Provide preset positions
and text fields as a complete touch alternative to dragging; verify drag does not
scroll the page or place text outside the image. The same canvas renders desktop,
phone preview and exported PNG.

**Gallery and account `/gallery`, `/artists`, `/artists/:slug`, `/me`, `/me/memes/:id`, `/m/:id`.**
Use two column art grids when labels remain readable; stack artist biography and
works. Replace the six portrait carousel view with a small, labelled set or a
scrollable row with obvious controls. Let search, filters and account controls
wrap without hiding their labels. Public meme pages must show the artwork, story
and share action without requiring account access. Destructive actions get a
phone-appropriate confirmation with clear text.

**Quiz `/quiz`, `/quiz/:game`.** On phones, present the three hall choices as
large cards sharing the floor plan's names, colors and record information; keep
the plan as optional context rather than the sole interaction target. Show the
question artwork before answer cards, and reveal facts immediately after an
answer. The pair game uses tap-to-select and tap-to-match instead of requiring
dragging across three columns. Answer text and stamps must reflow. Recompose the
certificate as a readable single column; ornament never covers rank, score,
date or next action. Preserve the guest cap and signed-in records.

**Shared states.** Loading, empty, errors, auth prompts and guest allowance must
fit the same narrow layout. The guest ticket opens as a contained popover or
sheet with a visible close path. Focus and scroll should return sensibly after
closing dialogs, selecting art, generating captions and advancing quiz questions.

## Design and code approach

1. **Record mobile frames before implementation.** Make 390 px reference frames
   for home, both creation entries, selected artwork panel, result, editor, story,
   gallery, account, quiz lobby, question, pair match and certificate. Also check
   320 px edge cases and a 768 px transition. Annotate content order, touch
   states, loading/empty/error states and the relationship to desktop Figma.
2. **Deepen the shared shell.** Let `Layout` own navigation placement and content
   clearance; let `Page` own responsive gutters, header wrapping and action order.
   Page modules should not each calculate rail or bottom bar offsets. Add one
   shared source for bottom bar/selection panel clearance and safe area spacing.
3. **Keep state at existing seams.** Route modules continue to own fetching and
   flow state; `MemeWorkspace` owns result composition; `MemeCanvas` owns rendering
   and pointer behavior. Responsive variants consume existing state/actions.
   Do not copy pages, API calls, quiz scoring, auth rules or export accounting.
4. **Change layout where content changes meaning.** Prefer CSS grid/flex wrapping
   for simple stacks. Use a distinct mobile presentation only for the quiz hall
   picker and selection action panel, whose interaction changes. Keep their data
   and callbacks shared. Avoid viewport branching in the domain model.
5. **Preserve the existing visual system.** Reuse `tokens.css`, framed artwork,
   wall labels, gallery wall colors and current type families. Add only measured
   mobile spacing/type/layout tokens after the frames are reviewed. Preserve
   readable Ukrainian text and avoid using color alone to show selection.

This follows SOLID in practical terms: each module has one reason to change
(shell layout, page flow, canvas rendering, or export); page flows depend on the
small interfaces of the shared editor and shell; mobile presentation can replace
desktop presentation without changing the draft or route contract. Keep
interfaces narrow: pass state and callbacks that an interaction actually needs,
not a large `isMobile` prop threaded through every module. Extract a shared
module only when behavior is genuinely repeated.

## Delivery slices and acceptance

| Slice | Change | Reviewable exit condition |
|---|---|---|
| 1. Shell and home | Bottom navigation, page gutters, auth notice, home order | Home and all routes reachable at 320–430 px; desktop shell unchanged |
| 2. Creation entry | Phrase form, mode switch, catalogue grids/filters, selected panel | Both creation paths work with touch and keyboard; panel clears nav and keyboard |
| 3. Result/editor | Shared workspace, controls, story, canvas touch, PNG/share | Same draft and export on phone/desktop; story reachable; no unintended gesture loss |
| 4. Discovery/account | Gallery, artists, profile, saved/public meme views | Search/filter/card labels readable; public link and account actions work |
| 5. Quiz | Lobby cards, answer and pair interactions, certificate | All three games finish correctly as guest and signed-in visitor on a phone |
| 6. Quality pass | States, focus, reduced motion, overflow, device testing | No horizontal page scrolling at 320 px; controls reachable with text zoom and touch |

Each slice should be a small commit or coherent group of commits. Review a phone
screen and its desktop counterpart together so responsive work does not drift from
the established site. The quiz is included in the release gate even if delivered
after meme creation.

## Verification matrix

- Widths: 320, 375, 390, 430, 768, 1024 and 1440 CSS px; portrait and landscape
  where practical. Check 200% text enlargement and keyboard focus order.
- Devices: iOS Safari and Android Chrome for touch dragging, fixed navigation,
  virtual keyboard, PNG download and native share; desktop Chrome for regression.
- Journeys: phrase to result to edit/export; painting to AI caption; painting to
  own caption; gallery to artist to creation; guest allowance exhaustion and
  Google return to draft; saved/public meme; all three quiz games through result.
- States: loading, no results, failed request/retry, signed out, auth disabled,
  long Ukrainian titles/captions, portrait and landscape artwork, reduced motion.
- Automated smoke checks should assert route navigation, absence of horizontal
  overflow, key controls and preserved draft at the representative widths.
  Manual device checks remain necessary for native share and canvas gestures.

The 320 CSS px reflow check follows [WCAG 2.2 understanding for reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
Make touch targets comfortably larger than the [WCAG 2.2 minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
aiming for 44 px where space allows. Bottom controls should use CSS
[`safe-area-inset-bottom`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)
with a fallback.

## Release and open design checks

Release behind the normal frontend deployment path after desktop and phone
journeys pass. No data migration or API change is expected. Track any API change
as its own decision if implementation reveals one.

Before coding, review the mobile frames for three questions: whether five bottom
destinations remain readable at 320 px; whether the selection panel makes the AI
and own-caption actions equally understandable; and how much of the story should
appear before advanced editor controls. These are visual/interaction checks, not
new product rules.
