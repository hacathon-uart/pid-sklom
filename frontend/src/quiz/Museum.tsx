/** Museum pieces of the quiz (quiz direction board): brass plaque, turnstile counter, honours board, ranks. */
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { QuizEnd, QuizGame } from "../api/types";
import { GAME_ORDER, GAMES } from "./games";

/** Engraved brass plaque with two screws. */
export function BrassPlaque({ children, tarnished = false, className = "" }: { children: ReactNode; tarnished?: boolean; className?: string }) {
  return (
    <div className={`brass brass-screws px-7 py-2 text-center ${tarnished ? "tarnished" : ""} ${className}`}>
      {children}
    </div>
  );
}

/** S1 · Visitor turnstile counter: three flip digits; a changed digit flips in. */
export function Turnstile({ value, label }: { value: number; label: string }) {
  const digits = String(Math.min(value, 999)).padStart(3, "0").split("");
  return (
    <div className="turnstile" role="img" aria-label={`${label}: ${value}`}>
      {digits.map((d, i) => (
        // Keyed by position + digit, so only the digits that changed remount and flip.
        <span key={`${i}:${d}`} className={value > 0 ? "flip" : undefined}>{d}</span>
      ))}
    </div>
  );
}

/** Museum rank on the R1 certificate, by the number of paintings recognised. */
export function rank(game: QuizGame, score: number, finished: QuizEnd): string {
  const paintings = game === "pairs" ? score * 3 : score;
  if (finished === "complete") return "Директор музею";
  if (paintings >= 20) return "Куратор";
  if (paintings >= 10) return "Доглядач зали";
  if (paintings >= 3) return "Екскурсовод";
  return "Відвідувач";
}

/** H1 · Почесна дошка on the profile: a brass plaque per game, blank and tarnished until played. */
export function HonoursBoard({ best }: { best: Record<string, number> }) {
  const score = (game: QuizGame) => game === "titles"
    ? Math.max(-1, ...Object.entries(best).filter(([k]) => k.startsWith("titles:")).map(([, v]) => v))
    : best[game] ?? -1;
  return (
    <section className="honours mb-8 flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5" aria-label="Почесна дошка: рекорди вікторини">
      <div className="mr-2">
        <div className="font-heading text-[26px] italic leading-none text-[#f0d690]">Почесна дошка</div>
        <Link to="/quiz" className="t-caption mt-1 inline-block text-[#d9c3a9] hover:text-white">До вікторини →</Link>
      </div>
      {GAME_ORDER.map((game) => {
        const value = score(game);
        return (
          <BrassPlaque key={game} tarnished={value < 0} className="flex min-w-[180px] flex-1 items-baseline justify-between gap-4 !px-8">
            <span className="text-[13px] font-bold">{GAMES[game].title}</span>
            <span className="engraved text-[26px] leading-none">{value >= 0 ? value : "—"}</span>
          </BrassPlaque>
        );
      })}
    </section>
  );
}
