# ADR 0002: How a painting is chosen for a phrase

- **Status:** Proposed
- **Date:** 2026-11-17
- **Related:** ADR 0001 (data storage), `backend/app/ai/`, `backend/app/services/create.py`, plan §4, plan tasks T05, T13

## Implementation checkpoint (2026-11-17)

Merged revision `c1f7e57` implements Gemini query/document embeddings, the
`artwork_embeddings` table, an in-memory NumPy index and the embedding import script.
`LLMProvider` is no longer empty. Hybrid reranking and Flow B caption generation
remain unimplemented; the code uses embedding ranking and prewritten captions
respectively. This ADR's broader evaluation, cache and startup design is not a
statement that those features all shipped.
[ADR 0003](0003-portable-render-first-release.md) supersedes the free-Render hosting
assumption and defers rate limiting/circuit breakers for the initial release.

For the first release, startup now rejects missing/incompatible vectors or visible
artworks without situation vectors instead of merely logging and serving them via
fallback. Runtime provider errors still use the explicitly marked stub fallback.
The importer reuses its local embedding cache but replaces the selected model/dimension
rows in Supabase with a non-atomic delete/insert; it is not an atomic publication
workflow. The obsolete `match_artworks()` SQL function is dropped, not retained unused.
Batching/throttling behavior comes from the current embedding helper, not the
100-text request estimate below. Mode overrides, demo-query warming, the proposed
evaluation suite and user-facing provider notices are not established by this ADR.
The original design below remains a proposal wherever it exceeds that implementation;
its "never shows an error" wording is an intention, not an availability guarantee.

## Context

Flow A ("Фраза → картина", `POST /api/matches`) takes a short Ukrainian phrase such as
«коли дедлайн завтра», plus an optional description of the wanted picture. It returns the
best painting, four alternatives (Top-5), a caption position and the facts for the StoryCard.

What exists today:

- `AIProvider` interface (`ai/base.py`) with two implementations. `StubProvider` matches
  words by their first five letters. `LLMProvider` is still empty.
- `services/create.py` already enforces an 8 s timeout, falls back to the stub on any error,
  ignores ids the AI invented and caches repeated phrases.
- Every approved artwork has a reviewed meme profile: description, people, mood, **7–8 meme
  situations** written the way people talk, tags, `do_not_use_for`, `is_sensitive` and
  `caption_position`. `embedding_text` is built from these. 13 approved artworks now, about
  150 planned.
- `artworks.embedding vector(1536)` exists in the schema, but no vectors yet.

The plan's first idea was to send the whole catalogue to an LLM on every request. That is
about 6,000 tokens per request and gets worse past about 300 artworks. Word matching
(the stub) misses paraphrases: «завтра здавати, а я не починав» shares no words with
«коли дедлайн горить».

Constraints: Gemini API on the **free tier** (low and changing rate limits; Google may use
free-tier inputs to improve its products), Render free tier (512 MB RAM, sleeps), 7-day
hackathon, Ukrainian only.

## Decision

### 1. Provider: Gemini API, free tier, models set by config

- Embeddings: `gemini-embedding-2` (stable, multilingual, 8,192-token input).
  `gemini-embedding-001` scored the same on the first check (see the evaluation log) and
  stays as the fallback choice.
- LLM for the hybrid mode: `gemini-3.1-flash-lite` (stable, about 5 s on the free tier).
  Pinned versions, not `-latest` aliases, so results stay reproducible. Checked on our key
  on 2026-11-17: the Flash models (`gemini-3.5-flash`, `gemini-3.8-flash`) returned
  503 "high demand", `gemini-3.5-flash-lite` varied from 1.5 s to 12 s, and the 2.5 models
  are closed to new users.
- Model names come from env (`EMBEDDING_MODEL`, `AI_MODEL`), never from code, because
  Gemini model names and free-tier availability change often.
- Vector size: **768** (`output_dimensionality=768`). That is enough for about 1,500 short
  texts and keeps memory and storage small. Truncated Gemini vectors must be
  **L2-normalised** before cosine similarity.
- Task types: `RETRIEVAL_DOCUMENT` for painting texts, `RETRIEVAL_QUERY` for user phrases.
  `SEMANTIC_SIMILARITY` on both sides is the alternative, and the evaluation (section 7)
  picks the winner. On the first check `gemini-embedding-2` gave identical results with
  both, so it may ignore the task type.
- Free-tier rate limit counts **each text in a batch**: batches of 100 texts got HTTP 429
  at once, and batches of 20 every 3 s were throttled about 1 time in 4. The embed script sends small
  batches, waits on 429 and resumes. A full run for about 150 artworks (about 1,500 texts)
  takes roughly 15–20 minutes, once. At runtime a phrase costs one embedding call.
- The hybrid LLM call often takes longer than 5 s on the free tier. So **`embeddings` is
  the default mode** and `hybrid` is for experiments until the evaluation shows it is worth
  the latency.

### 2. What is embedded: one vector per situation, plus one for the whole profile

For every approved artwork, `data/scripts/embed_artworks.py` creates:

| kind | text | per artwork |
|---|---|---|
| `situation` | one meme situation, as written («коли родичі обговорюють твоє життя без тебе») | 7–8 |
| `whole` | `embedding_text` (title, artist, description, mood, situations, tags) | 1 |
| `avoid` | one `do_not_use_for` rule | 0–2 |

Short user phrases are closest to short situations. A single long vector blurs them with
the description and tags. The `whole` vector catches phrases about what is *visible*
(«дівчина зі свічкою»). The `avoid` vectors guard sensitive works (section 4).

Score of an artwork for a query `q`:

```
score = 0.7 · max(sim(q, situation_i)) + 0.3 · sim(q, whole)
```

The weights live in config and are tuned with the evaluation set. The best-matching
situation is kept and becomes the human-readable `reason`, for example
«Схоже на: коли всі святкують, а ти хочеш додому».

### 3. Storage and search: vectors stored in Supabase, searched in backend memory

- New table `artwork_embeddings (artwork_id, kind, text, text_hash, model, dim, embedding vector(768))`.
  The unused `artworks.embedding` and `embedding_model` columns are dropped.
- The embed script is re-runnable. It re-embeds only rows whose `text_hash` or `model`
  changed, and sends up to 100 texts per batch request. About 150 artworks come to roughly
  1,500 texts, or about 15 requests, which fits the free tier.
- At startup the backend loads all vectors of visible artworks into a numpy matrix
  (≈1,500 × 768 floats ≈ 5 MB) and computes cosine similarity in memory, in under 5 ms.
  This works the same in `DATA_BACKEND=local` (vectors from a gitignored cache file the script
  also writes) and `supabase`. `match_artworks()` in pgvector stays unused until the
  catalogue is far larger.
- A missing vector for an approved artwork is logged at startup. That artwork can still be
  found by the stub fallback.

### 4. Runtime pipeline, with two switchable modes

`MATCH_MODE=embeddings | hybrid` (env). For testing, a request may also pass `mode` when
`ALLOW_MODE_OVERRIDE=true`, which is for dev only and always off on the live site.

```
phrase (+ description)
  → moderation (existing check_text)
  → embed query (1 Gemini call, cached in memory by normalised text)
  → score all visible artworks in memory
  → sensitive guard
  → embeddings mode: top-5 by score
    hybrid mode:     top-10 → Gemini LLM ranks 5, picks position and facts
  → services/create.py validates ids, builds MatchResult
```

- **Query text:** phrase, plus « — » and the description when one is given. Whether to embed
  the description separately is left to the evaluation.
- **Sensitive guard:** if `sim(q, avoid_j)` ≥ 0.80 for any `avoid` vector of an artwork, that
  artwork is dropped. In embeddings mode, `is_sensitive` artworks also get score × 0.9, so
  they only win on a clear match. In hybrid mode the LLM additionally sees `is_sensitive` and
  `do_not_use_for` and must skip a candidate whose rule the phrase breaks. The threshold and
  penalty are starting values to tune.
- **Embeddings mode:** `position` = the profile's `caption_position`, facts = defaults,
  `reason` = best-matching situation. No LLM call.
- **Hybrid mode:** the prompt holds only the 10 candidates (id, title, short description,
  mood, situations, `do_not_use_for`, `is_sensitive`), about 1,500–2,000 tokens instead of
  6,000. The LLM returns JSON: ranked ids with scores, one-line reason, position, fact ids.
  Ids outside the 10 candidates are discarded. If fewer than 5 valid ids remain, the list is
  topped up from the embedding ranking.
- **Fallback chain:** hybrid → embeddings-only (LLM error, timeout or HTTP 429) → stub word
  matching (embedding error). No retries on 429, because on the free tier a retry only adds
  latency. Time budget: embedding call 3 s, LLM call 5 s, inside the existing 8 s.
- **`source`** in the response gets a third value: `ai` (hybrid), `embeddings`, `fallback`
  (stub). The frontend type mirrors it. It shows which path answered, and nothing changes
  in the UI.
- **Displayed score** («збіг 95%»): raw Gemini cosine similarities sit in a narrow band, so
  they are not shown as-is. Until the evaluation gives a calibration, the API returns
  `score = null` and the UI hides it.

### 5. Determinism

The same phrase gives the same result in the same mode. Results are cached in memory by
`(mode, model, phrase, description)`. Variety comes from the Top-5 alternatives and the
«Інша картина» button, not from randomness. That also keeps the evaluation reproducible.

### 6. Free-tier policy

- Only the phrase and the optional description are sent to Google. Never a user id,
  email or IP address.
- Moderation runs before any Gemini call.
- The site footer and the bot's /start message say that phrases are processed by Google
  Gemini.
- Rate-limit hits are expected. The embeddings mode costs **one** call per new phrase, and
  the hybrid mode costs two. The query cache, plus the demo phrases warmed at startup, keeps
  the demo off the network.
- We accept that Google may use typed phrases to improve its products. We revisit
  (enable billing) before any real launch.

### 7. Evaluation: test set and script, run before every tuning change

- `data/eval/match_phrases.json` has about 40 realistic phrases. Each lists `expected`
  artwork ids, where one of them should win, and optional `acceptable` ids. The phrases
  are **paraphrases, not copies** of the situations. They include slang, typos, a little
  surzhyk, phrases about what is visible, and a few that must *not* pick a sensitive work.
  Drafted by A, reviewed by the content reviewer.
- `data/scripts/eval_matching.py` runs every phrase through `embeddings` and `hybrid`, and
  through the task-type variants. It reports **hit@1, hit@5, MRR**, median and p95
  latency, the share of fallbacks, and sensitive-guard violations. Results are pasted into
  this ADR's log below.
- Weights, threshold, query composition and task type change only when the evaluation
  shows an improvement.

## Alternatives considered

| Option | Why not |
|---|---|
| LLM over the whole catalogue (plan §4) | About 6,000 tokens and 2 Gemini-heavy seconds per request, worse with every new artwork, no fallback below the stub |
| One vector per artwork (`embedding_text` only) | Long mixed text blurs short-phrase matches; kept only as the `whole` part of the score |
| pgvector search (`match_artworks()`) | Needs a per-situation table anyway and only works in Supabase mode; in-memory search is simpler and fast enough for about 1,500 vectors |
| Local open-source embedding model (e.g. multilingual-e5) | Does not fit Render's free 512 MB RAM next to the app |
| OpenAI or Claude | No credits; the provider interface keeps a later switch to one class |
| Random pick among the top 3 | Same phrase gives different results, which breaks caching and evaluation; Top-5 already gives variety |
| Image (multimodal) embeddings | Profiles already describe the images in Ukrainian; text-to-text matching is what the phrase needs |

## Consequences

**Good**

- The embeddings mode answers in one cheap call, works on the free tier and needs no prompt.
- The hybrid mode adds humour judgement, caption position and fact choice at about a third of
  the old prompt size.
- Three-level fallback: the demo never shows an error.
- Changing the model or weights is a config change plus a re-run of the embed script, and the
  evaluation shows whether it helped.

**Costs and follow-up work**

- Schema: `artwork_embeddings` table, `vector(768)`, drop `artworks.embedding` and
  `embedding_model`. Grants as in `schema.sql`.
- `data/scripts/embed_artworks.py`: batch embedding, `text_hash` skip, writes to Supabase and
  the local cache.
- `ai/gemini.py`: `embed(texts, task_type)` and `rank(phrase, candidates)`.
  `ai/matching.py`: in-memory index, scoring, sensitive guard.
  `services/create.py`: modes and the fallback chain.
- `Source` gets `embeddings`, in `schemas.py` and the frontend `types.ts`.
- New dependency: `numpy`. New env: `EMBEDDING_MODEL`, `EMBEDDING_DIM`, `MATCH_MODE`,
  `ALLOW_MODE_OVERRIDE`. `AI_API_KEY` holds the Gemini key.
- Evaluation set and script; the first run decides the default `MATCH_MODE` for the demo.
- Every profile edit needs a re-run of the embed script after the import and upload scripts.
- Free tier: user phrases may be used by Google, and the limits can change without notice.
  Both are accepted for the hackathon and revisited before a real launch.
- Flow B (painting → captions) is out of scope here; see ADR 0003.

## Evaluation log

| Date | Mode | Model / task type | Weights | hit@1 | hit@5 | MRR | p95 latency | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-11-17 | embeddings | embedding-001, RETRIEVAL | sit .7 / whole .3 | 13/13 | 13/13 | 1.00 | – | Smoke test: 13 approved works, 13 easy paraphrases; top-1 margin 0.087 |
| 2026-11-17 | embeddings | embedding-001, RETRIEVAL | whole only | 12/13 | 12/13 | 0.93 | – | «баланс на картці» ranked 7th |
| 2026-11-17 | embeddings | embedding-2, RETRIEVAL or SEMANTIC | sit .7 / whole .3 | 13/13 | 13/13 | 1.00 | – | Top-1 margin 0.091 |
| 2026-11-17 | embeddings | embedding-2, RETRIEVAL or SEMANTIC | whole only | 11/13 | 11/13 | 0.87 | – | 2 phrases ranked 7th; confirms per-situation vectors |
