# ADR 0009: One responsive frontend for desktop and mobile

- **Status:** Accepted
- **Date:** 2026-11-18
- **Related:** [Mobile frontend plan](../MOBILE_FRONTEND_PLAN.md), [Design reference](../design/README.md), [ADR 0008](0008-art-quizzes.md)

## Context

The current React frontend, its routes, editor draft, guest allowances, authentication,
catalogue and quiz already form one product. The desktop Figma screens are the visual
reference, but there is no mobile design. A separate mobile app or duplicate route tree
would require the same flows and state rules to be maintained twice. Simply shrinking
the desktop layout would make the painting picker, editor and quiz difficult to use.

## Decision

Build a responsive mobile website in the existing React app. Keep the same URLs,
backend contracts, draft model, allowance rules and artwork content across viewports.
Use one semantic page structure with responsive layout and, where interaction must
change, small viewport-specific presentation modules backed by the same state and
actions. The editor canvas and export logic remain shared. Mobile navigation replaces
the desktop rail with a bottom bar, while deep pages retain visible back navigation.

The mobile design keeps the desktop museum identity: warm surfaces, artwork frames,
gallery labels, typography and restrained brown accent. It changes density, order and
controls for a narrow screen. The artwork and its reviewed story remain visible parts
of the result, even when they stack instead of appearing side by side.

The website remains a browser experience. Offline support, an installable PWA, and
native applications are separate decisions if there is later evidence for them.

## Consequences

- Route and business behavior are tested once; responsive presentation is tested at
  representative widths and on touch devices.
- Desktop and mobile share accessible control semantics. The floor plan may need a
  mobile list of the same quiz halls because scaled SVG targets become too small.
- Sticky controls must account for the bottom bar, browser chrome, keyboard and safe
  area. Export and share must be verified on iOS Safari and Android Chrome.
- Mobile is part of normal frontend development, including future quiz and account
  changes, rather than a parallel project.
