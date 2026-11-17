# ADR 0003: How captions are generated for a chosen painting

- **Status:** Proposed
- **Date:** 2026-11-17
- **Related:** ADR 0002 (matching engine), `backend/app/ai/llm.py`, `backend/app/ai/gemini.py`, `backend/app/ai/prompts.py`, `backend/app/services/create.py`, `docs/KNOWN_ISSUES.md`

## Context

Flow B ("Картина → підпис", `POST /api/artworks/{id}/captions`) is the reverse of Flow A. The user
picks a painting from the catalogue and gets three short Ukrainian meme captions: one about
everyday life, one about work or study, one playful line from the painting's own story. The
«Ще варіанти» button asks again and sends the captions already shown as `exclude`.

What exists:

- `services/create.py::suggest_captions` already enforces the 8 s timeout, falls back to the stub on
  any error and runs the moderation check on every caption.
- Every approved artwork has a reviewed meme profile: description, mood, meme situations, tags,
  `do_not_use_for` and `is_sensitive`.
- ADR 0002 set up Gemini over plain HTTP (`ai/gemini.py`), the free tier and the fallback idea.
  It left Flow B out of scope.

Constraints are the same as ADR 0002: Gemini free tier with low and changing rate limits, Ukrainian
only, and the demo must never show an error.

## Decision

### 1. One Gemini text call over the painting's text profile. No image is sent

The user can only choose a painting that is already in the catalogue, and `profile_artworks.py`
has already turned each image into a reviewed Ukrainian description. We send that text:
about text, mood, meme situations, tags, plus the title and artist.

This is cheaper and faster than sending an image, fits the 8 s timeout, and keeps the captions
consistent with what the matcher "sees". Sending the image only makes sense if users can later
upload their own picture.

`ai/gemini.py::generate_json` calls `{model}:generateContent` in JSON mode (`responseMimeType:
application/json`) using the same plain-httpx style as the embeddings code. `AI_MODEL` selects the model.

### 2. Prompt rules (`ai/prompts.py`)

- Three captions of at most 12 words, with fixed kinds `everyday`, `work`, `story`.
- The meme situations are **inspiration only**. The model must not copy them word for word, so the
  result does not look like the offline fallback. The captions must differ in mood and sentence
  structure.
- **Sensitive works:** when `is_sensitive` is set, the prompt requires a warm, gentle tone, at most light
  self-irony about everyday feelings, and forbids mocking suffering, death, war, faith or the people shown,
  as well as dark humour and sarcasm about the subject.
- **`do_not_use_for`:** the listed topics are passed to the model and must be avoided.
- «Ще варіанти»: the earlier captions go into the prompt as texts to avoid. The code also drops any
  returned caption that matches one of them.

### 3. Output handling

The reply is parsed as JSON. Empty or duplicate captions are dropped. A `kind` outside the three
allowed values is replaced by its position (1st everyday, 2nd work, 3rd story). The result is cut to
three. If nothing usable is left, the call raises so the fallback runs.
`check_text` still runs on every caption afterwards, as the last safety net. A prompt is a request, not a guarantee.

### 4. Fallback chain: the demo never shows an error

1. Gemini captions (`source: "ai"`).
2. If the call fails for any reason (no network, timeout, HTTP 429, bad JSON, no usable captions),
   `services/create.py` builds offline captions from the DB: the painting's `meme_situations`
   (capitalised) first, then its curated `fallback_captions`. `source` is `"fallback"`.
3. If that gives fewer than three, `StubProvider` adds generic captions.

`meme_situations` are used **also for sensitive works**. They are written and reviewed per painting,
so we treat them as safe. A sensitive painting with no situations falls through to its curated
captions and then to the generic ones.

The 8 s limit is a total limit on the whole call, not an inactivity timeout. Errors such as no network
or a bad key fail at once, so only a hung connection makes the user wait the full 8 s. `AI_TIMEOUT_S` can
be lowered to 4–5 s for a snappier demo.

### 5. Privacy and free tier

Only painting data (title, artist, public profile text) and the captions to avoid are sent to Google.
No user id, email or IP. There is no user phrase in Flow B. It costs one Gemini call per request, and the
fallback covers rate-limit hits.

## Known issue

The `story` caption asks for a line from the painting's history, but the prompt gets no verified facts
about the artwork or its author, so Gemini can state an untrue detail. The shared `SYSTEM` prompt also still
says «choose only from the given facts by id», which comes from Flow A and does not apply here. This is
tracked in `docs/KNOWN_ISSUES.md`. It is resolved once verified facts about the author and the painting
(`artwork.facts`, `artwork.artist_facts`) are passed into the prompt and `story` is limited to them.
Until then, `story` captions are unverified.

## Alternatives considered

| Option | Why not |
|---|---|
| Send the image to Gemini on every request | Slower and costlier, uses more free-tier quota, and the text profile already describes the image; only needed for user-uploaded pictures |
| Pick captions only from `meme_situations` (no LLM) | No variety and no «Ще варіанти»; kept as the fallback |
| One caption per call, three calls | Three times the quota and latency; one call gives three differing captions |
| Drop `meme_situations` for sensitive works in the fallback | The situations are reviewed per painting, so we trust them; the LLM path has its own tone rules |
| Block Flow B for sensitive works | Users still get a warm caption; a hard block gives an empty screen. Can be revisited if output is still tone-deaf |

## Consequences

**Good**

- One cheap call, no new dependency, same provider and config as Flow A.
- Fallback with real, reviewed content keeps the demo working with no network or quota.
- Tone rules for sensitive paintings now exist in the prompt, not only in the fallback.

**Costs and follow-up work**

- `story` captions can contain unverified facts until facts are in the prompt (see Known issue).
- The tone rules are a prompt, so Gemini can still miss them. Read the output for a few sensitive
  paintings before the demo.
- No evaluation set exists for captions yet. Quality is judged by reading the output for now.
- The fallback is only as good as the `meme_situations` in the DB. A painting without them shows the
  generic stub captions.
