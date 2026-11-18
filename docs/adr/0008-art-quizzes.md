# ADR 0008: Art quizzes with personal best scores and a short guest version

- **Status:** Accepted; best scores persist only after migration 0003 is applied
- **Date:** 2026-11-18
- **Related:** [ADR 0004](0004-reviewed-enrichment-and-catalogue-authority.md),
  [ADR 0006](0006-google-identity-and-guest-allowance.md), [Data model](../DATA_MODEL.md)

## Context

The site teaches Ukrainian art through humour, but a visitor only meets the
catalogue one artwork at a time while making a meme. A quiz reuses the same
published artworks, artists and reviewed facts as a second, playful way in:
look at a painting, recall who painted it or what it is called, and learn the
answer either way.

## Decision

Add a **«Вікторина»** tab (`/quiz`) beside Створити, Галерея and Профіль, with
three games. Every question shows the artwork image only. The artist, title,
year and caption stay hidden until the visitor answers.

| Game | Question | Answers | Run ends |
|---|---|---|---|
| **Хто автор?** | One artwork | Four artists | First wrong answer, or every eligible artwork has been shown |
| **Пари** | A round of three artworks and three artists | Match each artwork to its artist | First round with a wrong pair, or too few artists left for another round |
| **Назва картини** | One artwork, from one chosen artist or the whole catalogue | Four titles | First wrong answer, or the chosen scope is exhausted |

**Scoring.** One wrong answer ends a run, which keeps the games short.
- **Хто автор?** and **Назва картини** score one point per correct answer.
- **Пари** scores one point per completed round.
- Artworks do not repeat within a run.
- Exhausting the catalogue is a win, not a failure, and the result screen says so.

**After every answer**, show the artwork's title, artist and year. Add one
reviewed fact or the start of the artwork's story, with a link to its gallery
card. A wrong answer also reveals the right one. The quiz only uses facts that
are already approved for publication.

**Titles are multiple choice, not typed.** Typed Ukrainian titles vary in
quotes, abbreviations and transliteration, and fuzzy matching would make wrong
answers feel arbitrary. Four similar titles are hard enough.

**Hiding answers in the question.** The page must not reveal the answer before
the visitor picks.
- Image `alt` text, page titles and nearby markup must not name the artist or
  the title.
- The quiz uses the same image URLs as the gallery, and those may contain a
  slug. Leaving that leak in place is accepted under Trade-offs.

### Eligible content

- Use the same published set as the gallery: approved artworks and their
  artists, with no development opt-in to pending works.
- Wrong options come from the same set:
  - **Хто автор?** needs at least four artists with published artworks.
  - **Пари** needs three artworks by three different artists in each round.
  - **Назва картини** offers an artist as a scope only if that artist has at
    least four published artworks. The «whole catalogue» scope is always
    available.
- Prefer wrong options that are close: titles from the same artist, and artists
  from a similar period or genre when that data is available. If there are not
  enough, fall back to random choices.

### Signed-in visitors

- Runs are unlimited.
- The **best score** for each game, and for each scope of **Назва картини**, is
  stored on the account.
- The profile page shows these scores.
- The result screen shows the run score next to the best score and marks a new
  record.

### Guests

Guests can play a short version of each game:

| Game | Guest version |
|---|---|
| Хто автор? | 5 artworks |
| Пари | 1 round: 3 artworks and 3 artists |
| Назва картини | 5 artworks, from the whole catalogue only |

A guest run ends at the cap even with no wrong answers. It ends with a «Увійти
з Google» call to action that explains signing in gives unlimited runs and
saved scores. Guest scores are not stored.

The short version is a **preview limit per run, not a lifetime allowance**. A
guest may replay it. Unlike generations and PNG exports (ADR 0006, ADR 0007),
quiz questions cost no AI calls and no storage. Counting them in the
guest-operation ledger would add database writes and race handling without
protecting a real cost. The quiz therefore adds no third counter to the guest
ticket.

### Runs on the server

- The backend builds each question and checks each answer.
- The browser never receives the correct option before it answers.
- Run state is a backend-signed, short-lived run token, signed with the same
  approach as the guest credential. It holds the game, scope, score, artworks
  already shown and whether the run is a guest run.
- No table stores individual runs.
- Only the final best score is written. It goes to a new owner-scoped table,
  `quiz_best_scores (user_id, quiz_key, best_score, achieved_at)`, where
  `quiz_key` is `who`, `pairs` or `titles:<scope>`. It is added by the additive
  migration `data/migrations/0003_quiz_best_scores.sql`.
- A run that scores zero is not a record.
- If the score store is unavailable, for example before migration 0003 is
  applied, the games still work and scores are simply not shown or kept.

A guest token is capped at the preview length and cannot later be turned into
a signed-in record. Signing in mid-run starts a new run; the guest's score is
not carried over.

## Trade-offs

- **Cheating only affects your own record.** There is no public leaderboard,
  so a visitor who cheats only inflates their own personal best. The signed run
  token stops a visitor from posting an arbitrary score directly. It does not
  stop someone who reads image URLs, guesses from the slug or replays a token.
  These protections are a basic integrity check, not anti-cheat. A public
  leaderboard would need opaque image URLs and stored run state, and stays out
  of scope.
- **The catalogue is small and uneven.** The seed has 20 approved artworks
  from 6 artists, and 13 of them are by one artist.
  - With that seed, a full **Хто автор?** run lasts at most 20 questions.
  - **Пари** runs out of distinct artists after a few rounds.
  - Most artists cannot be offered as a **Назва картини** scope yet.

  The games must read eligibility from the published catalogue at run time,
  not from fixed numbers, and must hide a game or scope that cannot fill a
  question. They grow as ADR 0004's enrichment publishes more artists.
- **Ending on the first mistake is harsh but easy to follow.** It keeps runs
  short, which matters for a short guest version, and makes «best score» mean a
  streak. Lives or extra chances can be added later without changing what is
  stored.
- **Replayable guest runs add no new cost.** The guest limit nudges visitors to
  sign in; it is not a paywall. If quiz traffic ever becomes a real cost, the
  existing guest ledger can count it later.
- **No new infrastructure.** The quiz needs one additive migration and a few
  FastAPI endpoints. It needs no new provider, queue or paid instance.
