# Known issues

## Flow B (captions): the `story` caption can invent facts

**Where:** `backend/app/ai/llm.py` → `LLMProvider.captions()`, prompt `CAPTIONS` in `backend/app/ai/prompts.py`.

**What:** the third caption (`kind: "story"`) asks for a playful line "from the painting's own history", but the
prompt only gets the `about` text, mood, situations and tags. It does not get verified facts about the artwork or
its author, so Gemini may state a historical detail that is not true. The shared `SYSTEM` prompt says
«never invent facts, choose only from the given facts by id». That rule comes from Flow A and does not match
what Flow B actually receives.

**Planned fix:** once verified facts about the author and the painting are in the DB (`facts` table, already
exposed as `artwork.facts` / `artwork.artist_facts`), pass them into the prompt. Tell the model to base the `story`
caption only on those facts. Until then, treat `story` captions as unverified.
