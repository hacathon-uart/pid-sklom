# ADR 0007: Separate guest allowance for distinct PNG exports

- **Status:** Accepted; production activation requires migration 0002 and a staged release
- **Date:** 2026-11-18
- **Related:** [ADR 0006](0006-google-identity-and-guest-allowance.md), [Authentication map](../AUTHENTICATION.md)

Guest file-sharing UI and its native-share behavior below were superseded by
[ADR 0010](0010-member-link-sharing.md). The separate guest PNG allowance now
applies to downloads in the UI.

Keep the existing lifetime allowance of three successful guest AI generations.
Add a **separate** lifetime allowance of three distinct guest PNG exports.
Downloading or sharing a PNG file uses the same export allowance; sharing an
existing public meme link is not an export. An unchanged composition can be
exported again without using another slot, even after the allowance is exhausted.
Changing artwork, caption, layout, styling or included frame produces a distinct
composition. Signed-in users are exempt from both guest allowances.

The backend identifies a guest export by its artwork ID and decoded PNG pixels,
not the PNG container bytes. Metadata, compression and re-encoding cannot turn
the same image into another distinct export. Keep the two counters in the selected
museum-ticket UI beside page headings, not in another site-wide ribbon. Explain
both limits, repeated exports, and Google sign-in in the ticket.

## Trade-offs

Charging a single shared allowance would penalize generating and downloading the
same meme twice, so the two limits remain independent. Store export reservations
and completed fingerprints in the existing service-role-only operation ledger:
the additive `0002_guest_exports.sql` migration preserves earlier generation
counts, saved memes and artwork data. The guest credential stays stable.
Use bounded, fenced reservations to avoid races; canceling a native share releases
its pending slot. A blocked download may continue once after explicit Google login.
File-sharing after a redirect needs a new gesture to open the native share sheet.

This is a **signup gate in this application's UI**, not DRM or a comprehensive
download limit. A visitor can save a rendered image with browser tools, request a
public Storage image directly or reset browser storage. Do not claim that public
saved PNGs have become private. Exporting a public saved meme through the app
uses the guest allowance; copying its public link does not.

Keep the **runtime** `GUEST_EXPORT_LIMIT_ENABLED=false` while deploying the new
endpoint and UI; manual Blueprint auto-sync stays off even though its final
desired flag is true. Apply migration 0002 once and verify the new RPC before
enabling enforcement, which must happen only after a compatible frontend is
live. The migration may be applied before the code deploy. Rolling back disables
only this flag without dropping the additive migration or rotating the guest
secret.
