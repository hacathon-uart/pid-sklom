# Data stores and catalogue lifecycle

Updated against revision `c1f7e57` on 2026-11-17.
Domain vocabulary: [CONTEXT.md](../CONTEXT.md).
Decisions: [ADR 0001](adr/0001-artwork-data-storage.md),
[ADR 0002](adr/0002-painting-matching-engine.md) and
[ADR 0004](adr/0004-reviewed-enrichment-and-catalogue-authority.md).

## Baseline: one database, object storage, derived indexes

The application does **not** need a PNG database, a biography database and a
separate vector database. Use one Supabase project:

| Store | Contents | Current implementation |
| --- | --- | --- |
| Supabase Postgres | Artist identity/biography, artwork metadata and profiles, reviewed facts, saved-meme metadata and embedding vectors | [`data/schema.sql`](../data/schema.sql) |
| Supabase Storage | Artwork images/thumbnails/portraits and exported meme PNGs; Postgres keeps their URLs | Public `artworks`, `portraits` (artist portraits) and `memes` buckets; bucket configuration is in the schema |
| Supabase Auth | Managed identities/sessions when application login is enabled; not a new database the app must operate | Existing frontend integration and legacy backend JWT verification are incomplete for release |
| Backend memory | Catalogue snapshots, NumPy vector index and request/bot caches | Disposable acceleration/state, not the durable source of truth |
| Local development files | Seed JSON, downloaded images and generated vector cache | Offline mode plus today's manual content pipeline |

Original paintings are normally stored as JPEG/WebP/PNG files, not necessarily
PNGs. The visitor's exported meme is PNG. Neither belongs in a Postgres binary
column in this design.

### Postgres relationships

```text
artists (1) --------< artworks (many)
   |                    |
   +--< facts           +--< facts
                        +--< artwork_embeddings
                        +--< memes ---- user_id ----> authenticated user identity
```

Each fact belongs to **either** an artist **or** an artwork, enforced by the schema.
The `memes.user_id` link is currently text, not an enforced foreign key to Auth.
User-facing auth and saving are not considered deployment-ready merely because
the table exists.

| Table / field | Meaning | Important invariant |
| --- | --- | --- |
| `artists` | Stable identity, name, biography, portrait URL and source references | An artist is independent of any one painting |
| `artworks` | Artist reference, title, source/license, image URLs, review status, fallback captions and matching metadata | Public repository responses include approved works; development can opt into pending works |
| `artworks.meme_profile` | Visual description, people, moods, meme situations and prohibited uses, with generation/review metadata | Interpretive matching material is not a verified historical fact |
| `facts` | Sourced historical statements with a `verified` flag | Public fact presentation must retain verification and artwork visibility checks |
| `artwork_embeddings` | Multiple `whole`, `situation` and `avoid` vectors for an artwork, with text/hash/model/dimension | Derived from versioned text with the same model/dimension as query embeddings |
| `memes` | Caption/style, artwork reference, image URL, user reference, favorite flag and creation time | Durable row and Storage object lifecycle must stay consistent |

The schema's current embedding column is **`vector(768)`**, not the earlier
`artworks.embedding vector(1536)`. Changing `EMBEDDING_DIM` alone does not migrate
that column. The schema migration removes the old vector column/function; preserve
anything needed before applying it to an existing project.

### Durable vectors versus vector search

[`embed_artworks.py`](../data/scripts/embed_artworks.py) derives vectors for each
real, non-rejected artwork: one whole-profile vector, one per meme situation, and
one per prohibited-use rule. It writes the model/dimension-tagged local cache and
can upload rows into `artwork_embeddings`.

[`matching.py`](../backend/app/ai/matching.py) loads configured model/dimension rows
from Supabase or the local cache into NumPy. The repository's visible catalogue
limits which artworks can be returned. Each uncached user phrase is embedded with
Gemini, then scored **in application memory**, not through a pgvector search query.
This is already implemented; hybrid reranking and generated captions are not.

The database stores pgvector values, but there is currently no active database-side
similarity search function or ANN index. A dedicated vector service is unnecessary
at this scale. Move search into Postgres if measured catalogue size/latency warrants
it, without introducing a second authoritative store.

The in-memory index and `data/embeddings/vectors.json` are rebuildable copies.
The cache is gitignored and must not be expected in a fresh container image.
Supabase mode loads durable vector rows; local mode needs a separately prepared
vector cache for live semantic matching, or uses the existing stub fallback.

## Capacity: database quota is not image quota

The expected **500 MB Postgres ceiling** includes tables, vector rows, indexes and
other database overhead. **Storage's 1 GB file quota and egress quotas are separate**;
staying below 500 MB does not guarantee staying within free image storage/traffic.
Provider sources and current limits: [Render/Supabase research](RENDER_RESEARCH.md).

For orientation, 150 artworks with roughly 10 vectors each at 768 float32 values
need about **4.6 MB of raw vector values** before row/index/text overhead. This is
an estimate, not a measured database footprint or guarantee. PNG files and repeated
downloads are likely to consume their separate quotas sooner; track all three.

Free Supabase can pause for inactivity even below 500 MB. Seed files can reconstruct
reviewed seed content, not user accounts, live-only edits, saved memes or image files.
A database export does not include Storage object bytes.

## Today: manual seed-authoritative content

```text
collected sources + reviewed profiles
    -> import_profiles.py
    -> data/seed/{artists,artworks,facts}.json
    -> process_images.py / data/images
    -> upload_to_supabase.py (images + content rows)
    -> embed_artworks.py (local cache + vector rows)
    -> refresh/restart backend catalogue and vector snapshots
```

This is the existing operating model, not an automated workflow. Check each
script's arguments and dry run before touching live data. The uploader excludes
placeholders by default; the embedding script excludes rejected works/placeholders.
Database review-status filtering remains necessary; uploading or embedding a row
does not publish it.

The vector uploader currently **deletes a model/dimension's rows and then inserts
batches**, without an atomic publication/version switch. An interrupted run can
leave incomplete vectors. It is not yet a production admin-workflow implementation.
Both catalogue and configured live vectors are loaded/cached at API startup; a database edit alone
does not refresh an already running process.

## Future: reviewed admin enrichment and database authority

Agreed direction, **not part of the first release**:

```text
admin enters artist name
    -> human resolves artist identity
    -> collect sourced artwork/biography material and eligible images
    -> prepare draft metadata, images, facts and meme profiles
    -> human checks identity, provenance/rights and factual claims
    -> generate compatible vector rows for approved material
    -> publish a coherent approved catalogue/vector version
    -> refresh runtime snapshots
```

Use the same Postgres and Storage services. Persisting draft/run progress and
stage outputs will need a future schema design; **no job/draft tables or automatic
publication mechanism exist today**. Human decisions and resumable deterministic
stages come first. Multi-agent orchestration is an optional implementation, not a
new database requirement or a commitment to a specific workflow product.

### What database-authoritative means

Today, an editor changes seeds and uploads them. After the future cutover, an
administrator changes/reviews content through the application and Postgres retains
the authoritative result. A painting added by an admin must survive a deployment
even if that painting is absent from Git.

Consequently, at cutover:

- Seeds initialize empty environments or capture exports; deploys do not blindly
  reapply old seeds over live records.
- Stable artist/artwork identities and non-destructive bootstrap are explicit.
  The current numeric-ID upsert is not enough to reconcile independent writers.
- Profile/model changes regenerate compatible vectors without mixing versions;
  failed stages preserve the last published content.
- Exports, database restoration and Storage restoration replace the assumption
  that Git alone can reconstruct all live content.

Administrator authorization is required before exposing any ingestion/internal
endpoint. It is separate from the deferred Google login for ordinary visitors;
do not equate any signed-in user with an administrator.

## Portability seams

Keep catalogue persistence behind the existing `Repository` interface. Embedding
retrieval currently lives in `matching.load_rows`, outside that repository, so a
database/provider migration must account for **both** code paths.

Hosting can move using Dockerfiles and environment configuration; moving data
providers also needs database and object migration, equivalent authorization,
and Auth-session/user-ID handling. Changing the embedding provider/model requires
re-embedding documents and queries into the same vector space. Containerizing the
application does not solve those migrations by itself.
