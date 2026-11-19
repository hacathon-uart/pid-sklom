/**
 * Museum pieces of the quiz (records direction board): museum ranks, cloakroom tags (B1),
 * catalogue record card (A3) and per-game entrance tickets on the profile (C4).
 */
import type { CSSProperties, ReactNode } from "react";
import type { QuizEnd, QuizGame, QuizInfo } from "../api/types";
import { GAME_ORDER, GAMES } from "./games";

// ---------- museum rank: a share of the collection, not a raw count ----------

/** The rank ladder, from the first right answer to the whole collection. */
const RANKS: [number, string][] = [
  [1, "Директор музею"],
  [0.9, "Куратор"],
  [0.6, "Науковий співробітник"],
  [0.3, "Екскурсовод"],
  [0.1, "Доглядач зали"],
  [0, "Відвідувач"],
];

/** How many paintings a game can show in one run: «Пари» shows three per round. */
function capacity(game: QuizGame, artworks: number) {
  return game === "pairs" ? Math.max(1, Math.floor(artworks / 3)) : Math.max(1, artworks);
}

/** Share of the whole collection (0..1) a score covers. `finished` = "complete" only counts for a run over the whole collection. */
export function share(game: QuizGame, score: number, artworks: number, finished?: QuizEnd | null): number {
  if (finished === "complete") return 1; // the whole collection, even if «Пари» ran out of distinct artists earlier
  return Math.min(1, score / capacity(game, artworks));
}

export function rankName(part: number): string {
  return RANKS.find(([min]) => part >= min)![1];
}

export const percent = (part: number) => `${Math.round(part * 100)}%`;

/** Best score and rank of a game. The base is always the whole collection, so a perfect run of one artist's works is not 100%. */
export function bestOf(game: QuizGame, info: QuizInfo): { score: number; part: number } | null {
  const best = info.best ?? {};
  const scores = Object.entries(best)
    .filter(([key]) => (game === "titles" ? key.startsWith("titles:") : key === game))
    .map(([, score]) => score);
  if (!scores.length) return null;
  const score = Math.max(...scores);
  return { score, part: share(game, score, info.artworks) };
}

// ---------- B1 · cloakroom tags ----------

/** The numbered token every museum cloakroom hands out. */
export function CloakroomTag({ value, label, tone = "ink" }: { value: ReactNode; label: string; tone?: "ink" | "burgundy" }) {
  return (
    <div className={`cloak-tag ${tone === "burgundy" ? "cloak-burgundy" : ""}`} role="img" aria-label={`${label}: ${value}`}>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

// ---------- A3 · catalogue record card ----------

/** A typed catalogue card with dotted leaders: «Рекорд ……… 13», «Звання ……… Екскурсовод». */
export function CatalogueRecord({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="catalogue-card record-card min-w-0">
      {rows.map(([key, value]) => (
        <div key={key} className="leader-row max-md:!flex-wrap">
          <span className="max-md:!whitespace-normal">{key}</span>
          <i aria-hidden />
          <b className="min-w-0 max-md:w-full max-md:break-words max-md:!whitespace-normal">{value}</b>
        </div>
      ))}
      <span className="card-hole" aria-hidden />
    </div>
  );
}

// ---------- C4 · one entrance ticket per game on the profile ----------

/** Wall colours of the three halls, as on the floor plan. */
const HALL_COLOURS: Record<QuizGame, string> = { who: "#5E1F25", pairs: "#1F3B2D", titles: "#1C2E4A" };

export function RecordTickets({ info }: { info: QuizInfo }) {
  return (
    <section className="mb-8 flex flex-wrap gap-4" aria-label="Рекорди вікторини">
      {GAME_ORDER.map((game) => {
        const best = bestOf(game, info);
        return (
          <div
            key={game}
            className={`ticket ${best ? "" : "opacity-50 saturate-50"}`}
            style={{ "--ticket-bg": HALL_COLOURS[game], "--ticket-fg": "#F3E7D3" } as CSSProperties}
          >
            <div className="min-w-[190px]">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em]">Зала {GAMES[game].no}</div>
              <div className="font-heading text-xl font-semibold italic leading-tight">{GAMES[game].title}</div>
              <div className="text-[12px]">{best ? `${rankName(best.part)} · ${percent(best.part)}` : "Ще не грали"}</div>
            </div>
            <div>{best ? best.score : "—"}</div>
          </div>
        );
      })}
    </section>
  );
}
