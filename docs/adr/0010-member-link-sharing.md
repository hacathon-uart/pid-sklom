# ADR 0010: Member-only meme link sharing

- **Status:** Accepted
- **Date:** 2026-11-20
- **Related:** [ADR 0006](0006-google-identity-and-guest-allowance.md), [ADR 0007](0007-distinct-guest-png-exports.md)

Guests may download a PNG but have no share action. A signed-in owner may share a
meme by saving the current editor composition, marking the saved meme as a
favourite, and copying its public `/m/:id` link. The UI shows the link and an
explicit copied state; if clipboard access fails, the link remains selectable.
Sharing from a saved-meme page also marks it as a favourite. Public visitors,
including signed-in nonowners, may view a link but do not see a share control.

This supersedes ADR 0007's guest file-sharing allowance and native-share UI
flow. The three-distinct-PNG guest allowance now covers downloads only. The
export endpoint still counts guest PNGs independently of the browser control;
this is a product UI rule, not a claim that a downloaded file cannot be sent
through another app. Saved memes remain public by link under ADR 0006.
