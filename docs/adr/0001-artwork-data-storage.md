# ADR 0001: Where artists, artworks and meme profiles are stored

- **Status:** Accepted
- **Date:** 2026-11-17
- **Related:** `data/schema.sql`, `docs/ARCHITECTURE.md`, plan tasks T04, T11, T12

## Evolution

This records the original decision. The merged implementation described in
[ADR 0002](0002-painting-matching-engine.md) now stores multiple 768-dimensional
vectors per artwork in `artwork_embeddings`, replacing the single
`artworks.embedding vector(1536)` representation below. ADR 0002 as a whole remains
proposed; not all of its runtime/evaluation design is implemented.
[ADR 0004](0004-reviewed-enrichment-and-catalogue-authority.md) changes seed authority
to database authority only when the future admin workflow ships. The current
[data map](../DATA_MODEL.md) distinguishes those stages.
[ADR 0003](0003-portable-render-first-release.md) records the current hosting,
budget and release-scope decisions; no privacy redesign is part of that release.

The sections below preserve the original design, not an implementation checklist.
The profile importer preserves IDs by matching Wikidata identities in the seeds;
the Supabase uploader upserts those numeric IDs, not Wikidata IDs. It must not be
treated as reconciliation with independently edited database content.
Saved memes are public by link under the current API/Storage model, not private
per-user files. The first public release disables account saving altogether;
neither this ADR nor disabling saving changes existing object access rules.
[ADR 0006](0006-google-identity-and-guest-allowance.md) keeps public-by-link access
for the next Google-account release while adding a durable operation ledger for
guest allowance and retry handling. The original "private to each user" wording
below is historical and does not describe file visibility.

## Context

The content pipeline now produces real data: `data/all_artworks.py` collects paintings from
Wikidata and Wikimedia Commons, and `data/artworks_meme_descriptions.json` holds one
AI-written meme profile per painting. The AI team needs a stable place to read this data from
before they can build matching and caption generation.

What we have to store:

- **Artists**: name, years, biography, portrait. Around 15 rows.
- **Artworks**: title, year, museum, licence, source. Around 150 rows.
- **Meme profile**, one per artwork: description, people, mood, meme situations, tags,
  sensitivity flags, review status, the model and prompt version that produced it.
- **Embedding** of each profile, for the vector search added on Days 3–4.
- **Facts** about artists and artworks, each with its own source and verified flag.
- **Image files**: 1200 px image and 400 px thumbnail per artwork.
- **User memes**: saved captions and rendered PNGs, private to each user.

Constraints: 4 people, 7 days, free hosting, a FastAPI backend that already reads data through
one `Repository` interface with a local JSON implementation and a Supabase stub.

## Decision

Use **Supabase** as the single store: **Postgres tables** for the data, **Supabase Storage**
for the files, **pgvector** in the same database for embeddings.

### 1. Separate tables for artists, artworks and facts

- `artists`: one row per artist.
- `artworks`: one row per painting, linked to its artist by `artist_id`.
- `facts`: one row per fact, linked to either an artist or an artwork.
- `memes`: one row per saved user meme (unchanged).

Artists are not copied into artwork rows. A biography is written once and every painting
points to it.

### 2. The meme profile lives inside the artwork row

A painting has exactly one profile, so a separate profile table would only add a join.

- The full profile is stored in `artworks.meme_profile` (`jsonb`), in the format defined in
  the "AI Engine & Artwork Data" approach document: `visual_description`, `people`, `mood`,
  `meme_situations`, `do_not_use_for`, `caption_position`, `confidence`, `model`,
  `prompt_version`, `generated_at`.
- Fields we filter or sort by are also real columns:

| Column | Type | Why it is a column |
|---|---|---|
| `review_status` | `text`: `pending`, `approved`, `rejected` | Only approved profiles go live |
| `is_sensitive` | `boolean` | Keep jokes away from tragic or religious works |
| `meme_potential` | `smallint`, 1–5 | Ranking and curation |
| `tags` | `text[]` (already exists) | Fallback tag matching |
| `embedding_text` | `text` | The exact text that was embedded |
| `embedding` | `vector(N)` | Vector search |
| `embedding_model` | `text` | Tells us which vectors are outdated after a model change |

### 3. Numeric ids stay; Wikidata ids are added next to them

The API, the frontend and the bot already use numeric ids. The collected data is keyed by
Wikidata ids such as `Q111822246`.

- Keep `id bigint` as the primary key of `artists` and `artworks`.
- Add `wikidata_id text unique` to both tables.
- Import scripts match rows by `wikidata_id`. A row that already exists keeps its numeric id;
  a new row gets the next free one. Re-running an import never changes an id.

### 4. Image files go to Storage; the database keeps only URLs

- Public bucket `artworks`: `<slug>.jpg` (1200 px long side) and `<slug>-thumb.jpg` (400 px).
- Public bucket `memes`: saved meme PNGs.
- `artworks.image_url` and `artworks.thumb_url` hold the public URLs.
- `licence` and `source_url` are stored for every image.

### 5. Seed JSON files mirror the tables

`data/seed/artists.json`, `artworks.json` and `facts.json` keep exactly the same columns as
the tables. Every data source (the collector output, the profile JSON, the Google Sheet)
is converted into these files first, and the same files are then upserted into Supabase.

This gives two working modes with one data shape:

- `DATA_BACKEND=local`: the backend reads the seed files. Works offline, with no keys.
- `DATA_BACKEND=supabase`: the backend reads the tables.

### 6. Embedding size is fixed when the AI provider is chosen

The column stays `vector(1536)` for now. The provider decision is still open, and the size
depends on the embedding model. No vectors exist yet, so changing the size later is a single
`alter table` with no data to migrate.

## Alternatives considered

| Option | Why not |
|---|---|
| One JSON file with the artist name inside every artwork | Biography duplicated per painting, a typo creates a "new" artist, no vector search, no user data |
| Seed JSON files only, no database | No vector search, nowhere to save user memes, merge conflicts when several people edit |
| Postgres plus a separate vector database (Pinecone, Qdrant) | A second service to run and keep in sync, for 150 rows |
| Document database (Firebase, MongoDB) | The schema, the backend and the auth plan are already built for Postgres and Supabase |
| Separate `artwork_profiles` table | One profile per artwork, so it adds a join and nothing else |

## Consequences

**Good**

- One service covers tables, files, vector search and login, all on the free tier.
- The AI team can start today on the seed files and switch to Supabase without changing code
  outside the repository layer.
- Each artist is described once; facts keep their own verification status.
- Stored model names and prompt versions let us regenerate only outdated profiles and vectors.

**Costs and follow-up work**

- `data/schema.sql` needs the new columns from sections 2 and 3.
- The profile format changes from `{description, mood, situations}` to the full format, so
  `LocalRepository.catalogue()` and the future `SupabaseRepository` must read the new field
  names (`meme_situations`, `mood` as a list).
- The repository must return only `review_status = 'approved'` artworks to users and to the
  AI. All current profiles are `pending`, so development needs a way to include them.
- An import script must map artist names in the profile JSON to `artist_id`.
- `data/seed/artists.json` must be aligned with the collector's artist list.
- Seed files and tables can drift apart. The seed files are the source of truth for content;
  Supabase is refilled from them by a re-runnable upsert.
