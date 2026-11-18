# Під склом: Design

> Ukrainian art through humour. Write a phrase, get a meme made from a public-domain Ukrainian painting, and read the story behind it.

This folder is the single source of truth for how the product should look and behave. Build the frontend from it.

**Figma file:** https://www.figma.com/design/WqmyJyABuY8diDwhSqCzeW  
**Language of the UI:** Ukrainian only  
**Screen size designed:** desktop, 1440 px wide (mobile is not designed yet)

**Mobile direction:** [responsive frontend plan](../MOBILE_FRONTEND_PLAN.md) and
[implementation sequence](../MOBILE_FRONTEND_IMPLEMENTATION.md), governed by
[ADR 0009](../adr/0009-one-responsive-frontend.md). Mobile reference frames remain
to be designed; the desktop Figma file and tokens guide their visual language.
The current build and release gaps are in the [mobile handoff](../MOBILE_FRONTEND_HANDOFF.md).

---

## 1. How to use the Figma file

1. Open the link above. Ask the owner for access if it says "request access".
2. Press **▶ Play** (top right) to click through the prototype. Two flows are ready:
   - **«Під склом — повний сценарій»** starts on the landing page.
   - **«Картина → підпис»** starts on the painting-choice screen.
3. Switch on **Dev Mode** (`</>` toggle, top right) and click any element to see its size, spacing, colour variable and font.
4. Colours are **Variables** (left toolbar → *Variables* → «Під склом / Colors»). Fonts are **Text styles**. Prefer these names in code over raw hex values.

> Placeholder text in the screens («Назва картини», «Імʼя Прізвище», sample jokes) only shows where content goes. Real content comes from the artworks database.

---

## 2. Design principles

- **The art comes first.** Quiet cream backgrounds and one brown accent, so the paintings and the story carry the page.
- **The story is the most valuable block.** The `StoryCard` is the largest element beside the meme on every result screen.
- **No obligations.** Everything except saving works without an account.
- **Minimal now, decorative later.** Picture frames and decorative fonts are planned for a later iteration. Keep the `Artwork` frame easy to restyle in one place.

---

## 3. Screens

Frame names are in Ukrainian in Figma; the numbers match the list below.

| # | Screen | Purpose | Related stories |
|---|--------|---------|-----------------|
| 1 | [Головна + Про проєкт](https://www.figma.com/design/WqmyJyABuY8diDwhSqCzeW?node-id=3-21) | Logo, tagline, phrase search, links to gallery and builder. Scrolls down to *About* and *Contacts*. **To do:** add the other ways to create a meme (see "Planned design changes") | US-01, US-06 |
| 2 | [Конструктор: введення](https://www.figma.com/design/WqmyJyABuY8diDwhSqCzeW?node-id=4-50) | Phrase → painting: caption and optional image description | US-01 |
| 3 | [Конструктор: результат](https://www.figma.com/design/WqmyJyABuY8diDwhSqCzeW?node-id=4-98) | Meme, caption, **StoryCard**, Top-5 alternative paintings | US-01, US-03 |
| 3b | [Редагування підпису](https://www.figma.com/design/WqmyJyABuY8diDwhSqCzeW?node-id=6-126) | Caption editor: font, size, colour, outline, position, extra text block | US-04, US-05 |
| 4 | [Профіль: мої меми](https://www.figma.com/design/WqmyJyABuY8diDwhSqCzeW?node-id=6-232) | Grid of saved memes with filters | US-08 |
| 4b | [Перегляд мему](https://www.figma.com/design/WqmyJyABuY8diDwhSqCzeW?node-id=7-233) | One saved meme: story, more works by the artist, download, share, delete | US-08 |
| 5 | [Галерея](https://www.figma.com/design/WqmyJyABuY8diDwhSqCzeW?node-id=7-311) | Search, authors row, paintings row, filters | US-09, US-14 |
| 5b | [Сторінка автора](https://www.figma.com/design/WqmyJyABuY8diDwhSqCzeW?node-id=7-422) | Extended bio, facts, featured painting, grid of works | US-10 |
| 2b | [Картина → підпис: вибір](https://www.figma.com/design/WqmyJyABuY8diDwhSqCzeW?node-id=10-384) | Pick a painting by search/filter/manually, then choose AI or own caption | US-02 |
| 3c | [Картина → підпис: результат](https://www.figma.com/design/WqmyJyABuY8diDwhSqCzeW?node-id=10-507) | 3 AI caption options, StoryCard, collapsed caption style (expands to editor 3b) | US-02, US-03, US-04 |
| 3d | [Картина → свій підпис](https://www.figma.com/design/WqmyJyABuY8diDwhSqCzeW?node-id=12-571) | Fully manual meme: user writes the caption, story still shown | US-02, US-04 |

Story IDs refer to the project plan (Section 6, *User stories*).

**Not designed yet:** login dialog, mobile layouts, empty states, loading and error states, share-link preview, Telegram bot (text only). Add these before the feature freeze if time allows.

### Planned design changes

- [ ] **Home page (screen 1) needs an update.** It currently offers only the phrase search and «Обрати картину в галереї». Add the other ways to create a meme: pick a favourite painting and let the AI write the caption (screen 3c), or do everything yourself, picking the painting and writing the caption (screen 3d). Both paths start on screen 2b. The design of this section is still to be decided.

---

## 4. User flows

```
Phrase → painting
  1 Головна ─► 3 Результат ─► 3b Редагування ─► 4 Мої меми ─► 4b Перегляд
               │ (Top-5: choose another painting)

Painting → caption
  1 Головна / 5 Галерея / 5b Автор ─► 2b Вибір картини
       ├─► 3c Підписи від ШІ ─► 3b Редагування ─► 4 Мої меми
       └─► 3d Свій підпис      ─► 4 Мої меми
            (3d ◄─► 3c: "Немає ідей?" hint switches to AI captions)

Story → art
  any StoryCard "Більше про автора" ─► 5b Сторінка автора ─► "Зробити мем" ─► 3c
```

- The **mode switch** («Фраза → картина / Картина → підпис») jumps between flows 2 and 2b.
- The **sidebar** (Головна, Створити, Галерея, Профіль) is on every screen except the landing hero's top bar, which also holds «Увійти / Зареєструватися».
- In the prototype, «Увійти» and «Зареєструватися» go straight to *Мої меми*, pretending to be logged in. Saving a meme requires login in the real product; creating one does not.

---

## 5. Design tokens

### Colours (Figma variables, collection «Під склом / Colors»)

| Token | Hex | Used for |
|-------|-----|----------|
| `bg` | `#F7F2EA` | Page background |
| `surface` | `#FCFAF6` | Cards, inputs, About section |
| `line` | `#E6DDCF` | Borders, dividers |
| `muted` | `#EFE6D8` | Sidebar, tags, mode switch, highlighted fact |
| `image` | `#E3D8C7` | Placeholder behind artworks |
| `text` | `#2E2620` | Main text |
| `text-secondary` | `#7A6E62` | Secondary text, hints |
| `accent` | `#8B6B4A` | Primary buttons, links, labels, selection |
| `accent-soft` | `#C9B08F` | Active nav item, frames, soft highlights |
| `white` | `#FFFFFF` | Text on accent, meme caption fill |

> If the team changes a colour in Figma (for example a lighter `bg`), update this table and `tokens.css` so the code stays in sync. Figma is the source.

### `tokens.css` (lives in `frontend/src/styles/tokens.css`)

In code, the same variables are declared inside Tailwind's `@theme { … }` block (not `:root`), so each one is also a utility class: `bg-accent`, `text-text-secondary`, `border-line`, `font-heading`, `rounded-card`. Update the values there when Figma changes.

```css
:root {
  --color-bg: #F7F2EA;
  --color-surface: #FCFAF6;
  --color-line: #E6DDCF;
  --color-muted: #EFE6D8;
  --color-image: #E3D8C7;
  --color-text: #2E2620;
  --color-text-secondary: #7A6E62;
  --color-accent: #8B6B4A;
  --color-accent-soft: #C9B08F;
  --color-white: #FFFFFF;

  --font-heading: "Cormorant Garamond", serif;
  --font-ui: "Manrope", system-ui, sans-serif;
  --font-meme: "Oswald", Impact, sans-serif;

  --radius-control: 10px;   /* buttons, inputs */
  --radius-card: 16px;      /* cards */
  --radius-story: 20px;     /* StoryCard */
  --sidebar-width: 88px;
}
```

### Typography

All three families are on Google Fonts and include Cyrillic with the Ukrainian letters **ґ є і ї**. Always test those letters and the apostrophe **ʼ** after any font change.

| Style (Figma) | Font | Size / line height | Notes |
|---------------|------|--------------------|-------|
| Display/Logo | Cormorant Garamond SemiBold Italic | 112 / 95% | «Під склом» on the landing page |
| Heading/H1 | Cormorant Garamond SemiBold | 56 / 110% | Page titles |
| Heading/H2 | Cormorant Garamond SemiBold | 36 / 115% | Section titles, StoryCard title |
| Heading/H3 | Manrope SemiBold | 20 / 130% | Block titles |
| Quote | Cormorant Garamond Italic | 24 / 135% | Tagline, «Несподіваний факт» |
| Body/Large | Manrope Regular | 18 / 160% | Story text |
| Body/Regular | Manrope Regular | 16 / 155% | Default text |
| Body/Strong | Manrope SemiBold | 15 / 140% | Sub-headings, links |
| Body/Small | Manrope Regular | 14 / 150% | Secondary text |
| Caption | Manrope Medium | 12 / 130% | Hints, meta |
| Label | Manrope Bold | 12, uppercase, +10% tracking | Section labels |
| Button | Manrope SemiBold | 15 / 120% | Buttons |
| Meme/Caption | Oswald SemiBold, uppercase | 40 (small: 20) | Meme text, white with dark outline |

The caption editor offers more fonts for memes (for example Rubik, Montserrat, Lobster, Comfortaa). Choose only fonts with full Cyrillic coverage, and use the **same font files** in the browser editor and in the Pillow renderer for the Telegram bot, so memes look identical.

---

## 6. Components

Reusable pieces in the Figma frame **Components** (above the screens). Build matching React components with the same names.

| Component | Notes |
|-----------|-------|
| `Button` (Primary / Secondary / Soft) | Primary is filled `accent`; Secondary has an `accent` outline; Soft uses `muted` |
| `IconButton` | 44 px, used for like, download, share, refresh |
| `Input`, `Textarea` | 52 px / 128 px high, `surface` fill, `line` border |
| `Tag` | Pill, used for filters and example phrases; active tag is filled `accent` |
| `Sidebar`, `NavItem` | 88 px wide, active item highlighted with `accent-soft` |
| `Artwork` | Frame around a painting. **Restyle here for decorative picture frames later** |
| `ArtworkCard`, `AuthorCard`, `MemeCard` | Cards for grids |
| `Portrait` | Round artist portrait |
| `StoryCard` | Painting and artist story: title, portrait, about the painting, highlighted surprising fact, about the artist, link to the author page, source line |
| `Icon/*` | 12 stroke icons, 24 px |

---

## 7. Notes for implementation

- **Caption editor (3b).** The caption must be draggable, resizable and styleable (font, size, colour, outline, top/middle/bottom presets, up to 2 text blocks). Suggested library: `react-konva`. Export the meme as PNG in the browser. Load images with `crossOrigin="anonymous"` or the export will fail.
- **Story content.** Facts come only from the verified `facts` table. The AI chooses which fact to show; it never invents facts. Show the source link in the StoryCard footer.
- **Anonymous use.** Creating, editing and downloading work without login. Login is required only for «Зберегти в «Мої меми»» and the profile page.
- **Meme watermark.** Add a small «Під склом» watermark when downloading a PNG.
- **Matching percentages** in the Top-5 row (screen 3) are optional. Remove them if the backend does not return a score.
- **Placeholders to replace:** contact email (`hello@pidsklom.ua`), Telegram bot handle (`@pidsklom_bot`), the About and Contacts texts, GitHub link, team info.
- **Tagline:** «Мистецтво крізь жарти» (change in Figma and in code together).

---

## 8. Exporting and updating this folder

1. **Screens:** in Figma, select a frame → *Export* (right panel) → PNG, 2x → save to `docs/design/screens/` using the names `01-landing.png`, `02-builder-input.png`, `03-builder-result.png`, `03b-caption-editor.png`, `04-my-memes.png`, `04b-meme-view.png`, `05-gallery.png`, `05b-author.png`, `2b-choose-painting.png`, `3c-ai-captions.png`, `3d-own-caption.png`.
2. **Backup:** *File → Save local copy (.fig)* → `docs/design/pidsklom.fig`.
3. After any design change, re-export the changed screens and update this README (screen table, tokens) in the **same commit** as the code change.

```
docs/
  design/
    README.md          ← this file
    screens/           ← exported PNGs
    pidsklom.fig       ← backup
frontend/
  src/styles/tokens.css
```
