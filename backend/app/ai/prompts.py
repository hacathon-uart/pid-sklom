"""Prompts (owner: A — T05, T13, T17, T31). Rules from plan §4.

Keep prompts here, not inline in llm.py, so they are easy to tune on Day 5.
"""

SYSTEM = """Ти — гумористичний куратор українського мистецтва для сайту «Під склом».
Правила:
- Відповідай лише українською і лише валідним JSON у погодженому форматі, без пояснень навколо.
- Гумор добрий: без образ груп людей, без жартів про війну й травму, без політики щодо живих людей.
- Ніколи не вигадуй фактів. Обирай лише з наданих фактів за їхніми id.
"""

# Flow A: phrase -> painting. {catalogue} = one line per artwork: "id | title | tags | situations"
MATCH = """Фраза користувача: «{phrase}»
Опис бажаної картини (може бути порожнім): «{description}»

Каталог картин:
{catalogue}

Обери до 5 картин, які найкраще пасують до фрази як мем, від найкращої.
Поверни JSON:
{{"ranked": [{{"id": 12, "score": 0.93}}, ...], "reason": "один рядок, чому перша пасує",
  "position": "top" | "bottom"}}
"""

# Flow B: painting -> 3 captions.
# {profile}: about text, mood, meme situations, tags. {sensitivity}: see CAPTIONS_SENSITIVE / CAPTIONS_NO_GO.
CAPTIONS = """Картина: «{title}», {artist}.
Профіль картини: {profile}
{sensitivity}Не повторюй ці підписи: {exclude}

Придумай 3 короткі різні підписи-меми (до 12 слів кожен):
1) про щоденне життя, 2) про роботу або навчання, 3) грайливий, з історії самої картини.
«Ситуації» в профілі — лише натхнення для теми. Не копіюй їх дослівно і не переказуй майже слово в слово:
придумай власне формулювання. Підписи мають відрізнятися за настроєм і будовою речення.
Поверни JSON: {{"captions": [{{"text": "...", "kind": "everyday"}}, {{"text": "...", "kind": "work"}},
  {{"text": "...", "kind": "story"}}]}}
"""

# Added to {sensitivity} when artworks.is_sensitive (tragic / religious / war works).
CAPTIONS_SENSITIVE = """УВАГА: картина чутлива (трагічна, релігійна або пов'язана з війною чи втратою).
Тон — теплий, лагідний, співчутливий, максимум легка самоіронія про власні буденні почуття.
Заборонено: висміювати страждання, смерть, війну, віру, зображених людей; чорний гумор; сарказм щодо сюжету картини.
"""

# Added to {sensitivity} when meme_profile.do_not_use_for is not empty.
CAPTIONS_NO_GO = "Не використовуй цю картину для тем: {topics}. Уникай їх у підписах.\n"

# Step 0 (data/scripts/profile_artworks.py): image -> meme profile.
PROFILE = """Опиши цю картину для підбору мемів. Поверни JSON:
{"description": "що зображено, 1-2 речення", "mood": "настрій і емоції",
 "tags": ["5-10 тегів"], "situations": ["3 буденні ситуації, до яких вона пасує, напр. «коли дедлайн завтра»"]}
"""
