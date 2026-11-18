/**
 * «Вікторина» lobby (ADR 0008), V3 «План поверху»: the museum leaflet floor plan with one hall per game.
 * Pick a hall on the plan; its sign beside the plan describes the game and leads in.
 * A game the catalogue cannot fill yet is a closed hall behind a velvet rope.
 */
import { useEffect, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import type { QuizGame, QuizInfo } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { authEnabled } from "../auth/supabase";
import { Button } from "../components/Button";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { bestKey, GAME_ORDER, GAMES } from "../quiz/games";
import { CatalogueRecord, percent, rankName, share } from "../quiz/Museum";

/** Halls on the plan (viewBox 640×420): wall colour follows the genre halls of the gallery. */
const HALLS: Record<QuizGame, { x: number; y: number; w: number; h: number; wall: string }> = {
  who: { x: 12, y: 12, w: 236, h: 250, wall: "#5E1F25" },
  pairs: { x: 248, y: 12, w: 380, h: 150, wall: "#1F3B2D" },
  titles: { x: 248, y: 162, w: 380, h: 246, wall: "#1C2E4A" },
};

export function QuizPage() {
  const { user, ready, login } = useAuth();
  const [info, setInfo] = useState<QuizInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<QuizGame | null>(null);

  useEffect(() => {
    if (!ready) return; // wait for the session, so best scores come back with the first request
    let active = true;
    setError(null);
    api.quiz().then((value) => active && setInfo(value)).catch((e: Error) => active && setError(e.message));
    return () => { active = false; };
  }, [ready, user?.id, attempt]);

  const game = selected ?? GAME_ORDER.find((g) => info?.games.includes(g)) ?? "who";

  return (
    <Page
      title="Вікторина"
      subtitle="Оберіть залу на плані. Подивіться на картину й пригадайте, хто її написав і як вона називається. Одна помилка завершує гру, а після кожної відповіді — етикетка з історією картини."
    >
      {error ? (
        <ErrorMessage error={error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !info ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] md:gap-10">
            <FloorPlan info={info} selected={game} onSelect={setSelected} />
            <HallSign key={game} game={game} info={info} />
          </div>
          {info.limited && authEnabled && (
            <div className="mt-10 flex flex-col items-stretch gap-4 md:flex-row md:items-center md:gap-6 rounded-card bg-muted px-6 py-5">
              <p className="t-body flex-1">
                Гості грають коротку версію кожної гри. Увійдіть, щоб грати без обмежень, обирати автора
                в «Назві картини» і зберігати звання в профілі.
              </p>
              <Button variant="secondary" className="shrink-0" onClick={() => void login()}>Увійти з Google</Button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

function FloorPlan({ info, selected, onSelect }: { info: QuizInfo; selected: QuizGame; onSelect: (game: QuizGame) => void }) {
  const record = (game: QuizGame) => {
    if (!info.games.includes(game)) return "ЗАЛ ЗАЧИНЕНО";
    if (info.limited) return `ГОСТЬОВИЙ: ${info.guest_limits[game]}`;
    const values = Object.entries(info.best ?? {}).filter(([k]) => k === game || (game === "titles" && k.startsWith("titles:")));
    return values.length ? `РЕКОРД ${Math.max(...values.map(([, v]) => v))}` : "РЕКОРДУ ЩЕ НЕМАЄ";
  };
  const keys = (game: QuizGame) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(game); }
  };

  return (
    <div className="min-w-0">
      <div className="mb-6 grid gap-3 md:hidden" role="group" aria-label="Зали вікторини">
        {GAME_ORDER.map((game) => (
          <button
            key={game}
            type="button"
            aria-pressed={selected === game}
            onClick={() => onSelect(game)}
            className={`min-h-11 rounded-card border bg-surface p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${selected === game ? "border-accent ring-2 ring-accent" : "border-line"}`}
          >
            <span className="t-label">Зала {GAMES[game].no} · {selected === game ? "Обрано · " : ""}{record(game)}</span>
            <span className="t-h3 mt-2 block break-words" style={{ color: HALLS[game].wall }}>{GAMES[game].title}</span>
            <span className="t-small mt-2 block text-text-secondary">{GAMES[game].level}</span>
          </button>
        ))}
      </div>
      <div className="rounded-card border border-line bg-surface p-4 md:p-5">
        <div className="md:hidden" aria-hidden="true">
          <p className="t-small mb-3 text-text-secondary">План для огляду. Оберіть залу на картці вище.</p>
        </div>
        <div className="t-label mb-3">План поверху</div>
        <svg viewBox="0 0 640 450" className="pointer-events-none block h-auto w-full md:hidden" aria-hidden="true" focusable="false"><use href="#quiz-floor-plan-content" /></svg>
        <svg viewBox="0 0 640 450" className="hidden h-auto w-full md:block" role="group" aria-label="План поверху: три зали вікторини">
          <g id="quiz-floor-plan-content">
          <defs>
            <pattern id="closed-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0 0v10" stroke="#2E2620" strokeOpacity=".14" strokeWidth="4" />
            </pattern>
            <linearGradient id="plan-brass" x1="0" x2="1"><stop offset="0" stopColor="#8a6a2c" /><stop offset=".5" stopColor="#f0d690" /><stop offset="1" stopColor="#8a6a2c" /></linearGradient>
          </defs>
          <rect x="12" y="12" width="616" height="396" fill="#FFFDF8" />
          {GAME_ORDER.map((game) => {
            const hall = HALLS[game];
            const open = info.games.includes(game);
            const cx = hall.x + hall.w / 2;
            const cy = hall.y + hall.h / 2;
            return (
              <g
                key={game}
                className={`plan-room ${open ? "" : "closed"}`}
                role="button"
                tabIndex={0}
                aria-pressed={selected === game}
                aria-label={`Зала ${GAMES[game].no}: ${GAMES[game].title}${open ? "" : ", зачинено"}`}
                onClick={() => onSelect(game)}
                onKeyDown={keys(game)}
              >
                <rect className="room-fill" x={hall.x} y={hall.y} width={hall.w} height={hall.h} fill={hall.wall} fillOpacity={0.14} />
                {!open && <rect x={hall.x} y={hall.y} width={hall.w} height={hall.h} fill="url(#closed-hatch)" />}
                <rect className="room-edge" x={hall.x} y={hall.y} width={hall.w} height={hall.h} fill="none" stroke="#2E2620" strokeWidth="2.5" />
                {/* A closed hall is laid out tighter, so its rope and posts stay inside the room (hall II is only 150 tall). */}
                <text x={cx} y={open ? cy - 22 : cy - 32} textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontStyle="italic" fontSize="40" fill={hall.wall}>{GAMES[game].no}</text>
                <text x={cx} y={open ? cy + 12 : cy} textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontWeight="600" fontSize="26" fill="#2E2620">{GAMES[game].title}</text>
                <text x={cx} y={open ? cy + 38 : cy + 24} textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight="700" fontSize="12" letterSpacing="1.5" fill={open ? "#8B6B4A" : "#7B1E2A"}>{record(game)}</text>
                {!open && (
                  <g aria-hidden>
                    <path d={`M${cx - 48} ${cy + 42} Q${cx} ${cy + 58} ${cx + 48} ${cy + 42}`} fill="none" stroke="#7B1E2A" strokeWidth="4" strokeLinecap="round" />
                    <g fill="url(#plan-brass)">
                      <rect x={cx - 52} y={cy + 38} width="8" height="22" /><circle cx={cx - 48} cy={cy + 37} r="5" />
                      <rect x={cx + 44} y={cy + 38} width="8" height="22" /><circle cx={cx + 48} cy={cy + 37} r="5" />
                    </g>
                  </g>
                )}
              </g>
            );
          })}
          {/* outer walls, doorways between halls and the entrance */}
          <rect x="12" y="12" width="616" height="396" fill="none" stroke="#2E2620" strokeWidth="5" />
          <path d="M12 262h236" stroke="#2E2620" strokeWidth="2.5" />
          <path d="M248 70v40M248 200v40M400 162h60M90 262h50M248 310v40" stroke="#FFFDF8" strokeWidth="7" />
          <path d="M70 408h80" stroke="#FFFDF8" strokeWidth="9" />
          <text x="110" y="300" textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight="700" fontSize="12" letterSpacing="2" fill="#7A6E62">ВЕСТИБЮЛЬ</text>
          <circle cx="110" cy="345" r="7" fill="#8B6B4A" />
          <text x="124" y="350" fontFamily="Manrope, sans-serif" fontSize="13" fill="#2E2620">ви тут</text>
          <text x="110" y="436" textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight="700" fontSize="12" letterSpacing="2" fill="#7A6E62">ВХІД</text>
          </g>
        </svg>
      </div>
    </div>
  );
}

/** The sign at the hall entrance: what the game is, the record, the scope, and the way in. */
function HallSign({ game, info }: { game: QuizGame; info: QuizInfo }) {
  const navigate = useNavigate();
  const meta = GAMES[game];
  const open = info.games.includes(game);
  const scopes = game === "titles" ? info.title_scopes.filter((s) => !info.limited || s.key === "all") : [];
  const [scope, setScope] = useState(scopes[0]?.key ?? "all");
  const best = info.best?.[bestKey(game, scope)];
  const record: [string, string | number][] = info.limited
    ? [["Гостьова версія", meta.guestShort(info.guest_limits[game])], ["Звання", "після входу"]]
    : best === undefined
      ? [["Рекорд", "—"], ["Звання", "ще попереду"]]
      : [["Рекорд", best], ["Звання", `${rankName(share(game, best, info.artworks))} · ${percent(share(game, best, info.artworks))}`]];
  const play = () => navigate(`/quiz/${game}${game === "titles" ? `?scope=${encodeURIComponent(scope)}` : ""}`);

  return (
    <section className="min-w-0 rounded-card border border-line bg-surface p-4 md:p-7" aria-live="polite">
      <div className="flex items-start justify-between gap-4">
        <span className="hall-no" aria-hidden>{meta.no}</span>
        <span className="t-label">{meta.level}</span>
      </div>
      <h2 className="t-h2 mt-4">{meta.title}</h2>
      <p className="t-body mt-3 text-text-secondary">{meta.text}</p>

      {!open ? (
        <p className="t-body mt-6 rounded-control bg-muted px-4 py-3">
          Зала поки зачинена: для цієї гри в колекції замало художників. Вона відчиниться, щойно картин побільшає.
        </p>
      ) : (
        <>
          {scopes.length > 1 && (
            <label className="mt-6 block">
              <span className="t-caption text-text-secondary">Картини</span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="mt-1 h-11 w-full rounded-control border border-line bg-surface px-3 text-[15px]"
              >
                {scopes.map((s) => (
                  <option key={s.key} value={s.key}>{s.key === "all" ? "Усі картини" : s.name} · {s.artworks}</option>
                ))}
              </select>
            </label>
          )}
          {/* A3 · the record and the museum rank as a typed catalogue card */}
          <div className="mt-6">
            <CatalogueRecord rows={record} />
            <p className="t-caption mt-3 text-text-secondary">
              Звання залежить від частки колекції, яку ви впізнали: від відвідувача до директора музею за 100%.
            </p>
          </div>
          <div className="mt-6">
            <Button className="min-h-11 w-full md:w-auto" onClick={play}>Увійти до зали</Button>
          </div>
        </>
      )}
    </section>
  );
}
