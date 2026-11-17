# ADR 0004: Human-reviewed enrichment with a database-authoritative catalogue

- **Status:** Accepted direction; future implementation
- **Date:** 2026-11-17
- **Related:** [Data map](../DATA_MODEL.md), [ADR 0001](0001-artwork-data-storage.md),
  [ADR 0002](0002-painting-matching-engine.md), [ADR 0003](0003-portable-render-first-release.md)

Keep one Supabase Postgres database for artists, artworks, facts, memes and embedding
rows, with image bytes in Supabase Storage. A vector database is a capability of
this Postgres database through pgvector, not a separate system to buy or synchronize.
The current matcher searches a derived in-memory index; that index is not another
authoritative database.

When an administrator-operated enrichment workflow ships, **Postgres becomes the
authority for the managed catalogue**. Seed JSON then becomes bootstrap data for
empty environments and an export/snapshot format, not a deployment-time overwrite
of live edits. This replaces ADR 0001 section 5's seed-authority rule **at that future
cutover**, not today. Until then, keep the existing manual seed/import workflow.

## Enrichment direction

An administrator enters an artist name, resolves the intended artist identity, and
starts staged enrichment: discover source material, collect eligible images and
biographical sources, prepare image variants and draft descriptions/meme profiles,
review the material, generate matching embeddings, and publish approved content.
An ambiguous name must not silently select a different artist.

Human approval is required before publication. A generated description is not a
verified historical fact; image provenance and rights need review. Draft or rejected
material must not become public merely because a workflow stage completed.

The workflow must preserve stable artist/artwork identities, source provenance and
model/profile versions; retries must not duplicate content. Failed enrichment or
embedding steps must leave the last approved published version usable. These are
workflow requirements, not properties of the current upload scripts.

Multi-stage execution is agreed; **multi-agent execution is only an option**.
Choose ordinary deterministic stages first where they suffice. A workflow engine,
queue, job schema and agent topology are deliberately undecided and are not needed
for the first release.

## Trade-off and cutover requirement

Database authority supports interactive reviewed content changes without a code
release, but loses Git as the sole content history/recovery mechanism. Before the
cutover, define draft/review publication, export/restore, non-destructive bootstrap,
stable-ID assignment and refreshed content/vector snapshots together. Back up
Storage objects separately from database rows.

For example, after an admin adds a painting absent from the repository seeds, the
next deploy must preserve that painting. The current uploader upserts by numeric
ID and is not an admin-safe reconciliation mechanism; do not reuse it unchanged
against a database-authoritative catalogue. A later model/dimension change also
requires re-embedding and, when dimensions change, a schema migration.
