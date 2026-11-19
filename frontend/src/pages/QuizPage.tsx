/**
 * «Вікторина» lobby (ADR 0008), V3 «План поверху»: the museum leaflet floor plan, one hall per game.
 * A line drawing in one colour: each hall with its interior (paintings, benches, sculptures) and a plaque at its centre;
 * clicking a hall starts its game. Under the plan, the rank ladder shows what more points earn.
 * A game the catalogue cannot fill yet is a closed hall behind a velvet rope.
 */
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import type { QuizGame, QuizInfo } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { authEnabled } from "../auth/supabase";
import { Button } from "../components/Button";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { GAME_ORDER, GAMES } from "../quiz/games";
import { bestOf, HALL_COLOURS, percent, RANKS, rankName } from "../quiz/Museum";

const INK = "#2E2620";
const LINE = "#8B6B4A"; // every object on the plan is drawn in this one colour
const SERIF = "Cormorant Garamond, Georgia, serif";
const SANS = "Manrope, sans-serif";

/** Halls on the plan (viewBox 1000×600) and the centre of each hall's plaque. */
const HALLS: Record<QuizGame, { x: number; y: number; w: number; h: number; cx: number; cy: number }> = {
  who: { x: 20, y: 20, w: 360, h: 360, cx: 200, cy: 196 },
  pairs: { x: 380, y: 20, w: 600, h: 230, cx: 680, cy: 138 },
  titles: { x: 380, y: 250, w: 600, h: 290, cx: 680, cy: 384 },
};

export function QuizPage() {
  const { user, ready, login } = useAuth();
  const [info, setInfo] = useState<QuizInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ready) return; // wait for the session, so best scores come back with the first request
    let active = true;
    setError(null);
    api.quiz().then((value) => active && setInfo(value)).catch((e: Error) => active && setError(e.message));
    return () => { active = false; };
  }, [ready, user?.id, attempt]);

  return (
    <Page title="Вікторина" subtitle="Натисніть на залу, щоб почати. Одна помилка — і гра завершується.">
      {error ? (
        <ErrorMessage error={error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !info ? (
        <Loading />
      ) : (
        <>
          {/* phones: the plan is too small to read, so the halls are plain cards; from a tablet up, the plan itself */}
          <HallCards info={info} />
          <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <FloorPlan info={info} />
            <RankLadder info={info} />
          </div>
          {info.limited && authEnabled && (
            <div className="mt-8 flex flex-col items-stretch gap-4 rounded-card bg-muted px-6 py-4 md:flex-row md:items-center md:gap-6">
              <p className="t-body flex-1">Гості грають коротку версію. Увійдіть, щоб грати без обмежень і зберігати звання.</p>
              <Button variant="secondary" className="min-h-11 shrink-0" onClick={() => void login()}>Увійти з Google</Button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

// ---------- the floor plan ----------

/** The line under a hall's title: closed, the guest allowance, or the record and rank. */
function hallStatus(game: QuizGame, info: QuizInfo) {
  if (!info.games.includes(game)) return "ЗАЛА ЗАЧИНЕНА";
  if (info.limited) return `${GAMES[game].level.toUpperCase()} · ${GAMES[game].guestShort(info.guest_limits[game]).toUpperCase()}`;
  const best = bestOf(game, info);
  return best ? `РЕКОРД ${best.score} · ${rankName(best.part).toUpperCase()}` : `${GAMES[game].level.toUpperCase()} · РЕКОРДУ ЩЕ НЕМАЄ`;
}

/** «Назва картини» always runs over the whole collection. */
const gamePath = (game: QuizGame) => `/quiz/${game}`;

/** Phones only: one card per hall, in the hall's colour, each one tap from its game. */
function HallCards({ info }: { info: QuizInfo }) {
  const navigate = useNavigate();
  return (
    <div className="mb-6 grid gap-3 md:hidden" role="group" aria-label="Зали вікторини">
      {GAME_ORDER.map((game) => {
        const open = info.games.includes(game);
        return (
          <button
            key={game}
            type="button"
            disabled={!open}
            onClick={() => navigate(gamePath(game))}
            className="flex min-h-11 min-w-0 items-center gap-4 rounded-card border border-line p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
            style={{ background: `color-mix(in srgb, ${HALL_COLOURS[game]} 10%, var(--color-surface))` }}
          >
            <span className="w-10 shrink-0 text-center font-heading text-[34px] font-semibold italic leading-none" style={{ color: HALL_COLOURS[game] }} aria-hidden>{GAMES[game].no}</span>
            <span className="min-w-0 flex-1">
              <span className="t-h3 block break-words">{GAMES[game].title}</span>
              <span className="t-label mt-1 block break-words">{hallStatus(game, info)}</span>
            </span>
            {open && <span className="shrink-0 rounded-control bg-accent px-3 py-2 text-[13px] font-bold tracking-[0.1em] text-white">ГРАТИ ▸</span>}
          </button>
        );
      })}
    </div>
  );
}

function FloorPlan({ info }: { info: QuizInfo }) {
  const navigate = useNavigate();
  const play = (game: QuizGame) => navigate(gamePath(game));
  const status = (game: QuizGame) => hallStatus(game, info);

  return (
    <div className="hidden min-w-0 rounded-card border border-line bg-surface p-4 md:block">
      <svg viewBox="0 0 1000 600" className="block h-auto w-full" role="group" aria-label="План музею: три зали вікторини">
        <PlanDefs />
        <rect x="20" y="20" width="960" height="520" fill="#FFFDF8" />
        <Vestibule />

        {GAME_ORDER.map((game) => {
          const hall = HALLS[game];
          const open = info.games.includes(game);
          const keys = (e: KeyboardEvent) => {
            if (open && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); play(game); }
          };
          return (
            <g
              key={game}
              className={`plan-room ${open ? "" : "closed"}`}
              role="link"
              tabIndex={open ? 0 : -1}
              aria-disabled={!open}
              aria-label={`Зала ${GAMES[game].no}: ${GAMES[game].title}. ${GAMES[game].text}${open ? "" : " Зачинено."}`}
              onClick={() => open && play(game)}
              onKeyDown={keys}
            >
              <rect className="room-tint" x={hall.x} y={hall.y} width={hall.w} height={hall.h} fill={HALL_COLOURS[game]} fillOpacity={0.13} />
              <rect className="room-edge" x={hall.x + 4} y={hall.y + 4} width={hall.w - 8} height={hall.h - 8} fill="none" stroke={LINE} strokeOpacity="0" strokeWidth="3" />
              <Interior game={game} />
              {!open && <rect x={hall.x} y={hall.y} width={hall.w} height={hall.h} fill="url(#closed-hatch)" />}
              <Plaque game={game} open={open} status={status(game)} />
            </g>
          );
        })}

        <Walls />
      </svg>
    </div>
  );
}

function PlanDefs() {
  return (
    <defs>
      <pattern id="closed-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M0 0v10" stroke={LINE} strokeOpacity=".35" strokeWidth="1" />
      </pattern>
      <filter id="plaque-shadow" x="-20%" y="-20%" width="140%" height="160%">
        <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor={INK} floodOpacity=".16" />
      </filter>
    </defs>
  );
}

/** Outer walls, the walls between halls with their doorways, and the entrance steps. */
function Walls() {
  return (
    <g fill="none" stroke={INK} strokeLinecap="square" pointerEvents="none">
      <path d="M380 20V100M380 160V430M380 490V540" strokeWidth="3" />
      <path d="M20 380H160M240 380H380" strokeWidth="3" />
      <path d="M380 250H640M720 250H980" strokeWidth="3" />
      {/* door leaves swinging open */}
      <g stroke={LINE} strokeWidth="1">
        <path d="M380 100h50M380 100a50 50 0 0 1 50 50" strokeDasharray="3 3" />
        <path d="M160 380v50M160 430a50 50 0 0 0 50-50" strokeDasharray="3 3" />
      </g>
      <path d="M20 20H980V540H240M160 540H20Z" strokeWidth="6" strokeLinejoin="miter" />
      {/* entrance steps */}
      <path d="M150 552h100M140 564h120M130 576h140" strokeWidth="1.2" stroke={LINE} />
    </g>
  );
}

/** Lobby: ticket desk, cloakroom, plants, the «you are here» dot and the entrance. */
function Vestibule() {
  return (
    <g pointerEvents="none" fill="none" stroke={LINE} strokeWidth="1.1" strokeOpacity=".45">
      {/* cloakroom: a rail with numbered tags */}
      <path d="M44 404h112" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i}>
          <path d={`M${52 + i * 19} 404v6`} />
          <rect x={46 + i * 19} y="410" width="12" height="18" rx="6" />
        </g>
      ))}
      {/* ticket desk with a chair */}
      <path d="M262 396h100v72h-16v-56h-84z" />
      <circle cx="322" cy="434" r="8" />
      <Plant x={50} y={508} />
      <Plant x={350} y={508} />
      {/* you are here */}
      <circle className="you-are-here" cx="200" cy="474" r="6" fill={LINE} fillOpacity="1" stroke="none" />
      <circle cx="200" cy="474" r="6" fill={LINE} stroke="none" />
      <text x="214" y="479" fontFamily={SANS} fontWeight="600" fontSize="14" fill={INK} stroke="none">ви тут</text>
      <text x="200" y="597" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="11" letterSpacing="3" fill={LINE} stroke="none">ВХІД</text>
    </g>
  );
}

function Plant({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="14" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <path key={a} d={`M${x} ${y}q4 -7 0 -12q-4 5 0 12`} transform={`rotate(${a} ${x} ${y})`} />
      ))}
    </g>
  );
}

/** A framed painting seen on the plan: an outer frame and the canvas inside it. */
function Painting({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} />
      <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} />
    </g>
  );
}

function Bench({ x, y, w = 80, vertical = false }: { x: number; y: number; w?: number; vertical?: boolean }) {
  const [bw, bh] = vertical ? [14, w] : [w, 14];
  return <rect x={x} y={y} width={bw} height={bh} rx="3" />;
}

function Sculpture({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 15} y={y - 15} width="30" height="30" />
      <circle cx={x} cy={y} r="8" />
    </g>
  );
}

/** A short velvet rope on two posts, in front of a prized painting. */
function Rope({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return (
    <g>
      <path d={`M${x1} ${y}Q${(x1 + x2) / 2} ${y + 12} ${x2} ${y}`} />
      <circle cx={x1} cy={y} r="4" />
      <circle cx={x2} cy={y} r="4" />
    </g>
  );
}

/** Each hall's furnishings follow its game: portraits for «Хто автор?», triptychs for «Пари», big canvases for «Назва картини». */
function Interior({ game }: { game: QuizGame }) {
  const items: ReactNode[] = [];
  if (game === "who") {
    [60, 122, 184, 246, 308].forEach((x, n) => items.push(<Painting key={`t${n}`} x={x} y={30} w={32} h={42} />));
    [100, 170, 240, 310].forEach((y, n) => items.push(<Painting key={`l${n}`} x={30} y={y} w={30} h={40} />));
    [196, 276].forEach((y, n) => items.push(<Painting key={`r${n}`} x={340} y={y} w={30} h={40} />));
    items.push(<Bench key="b" x={160} y={312} />, <Sculpture key="s" x={110} y={330} />, <Sculpture key="s2" x={290} y={330} />);
  }
  if (game === "pairs") {
    [416, 606, 820].forEach((gx, g) => [0, 1, 2].forEach((k) => items.push(
      <Painting key={`t${g}${k}`} x={gx + k * 42} y={30} w={36} h={30} />,
    )));
    [416, 820].forEach((gx, g) => [0, 1, 2].forEach((k) => items.push(
      <Painting key={`b${g}${k}`} x={gx + k * 42} y={210} w={36} h={30} />,
    )));
    items.push(<Bench key="b1" x={436} y={100} w={70} vertical />, <Bench key="b2" x={912} y={100} w={70} vertical />);
  }
  if (game === "titles") {
    [430, 520, 760, 856].forEach((x, n) => items.push(<Painting key={`t${n}`} x={x} y={262} w={64} h={34} />));
    [420, 516, 612, 708, 804, 900].forEach((x, n) => items.push(<Painting key={`b${n}`} x={x} y={494} w={60} h={36} />));
    items.push(<Painting key="big" x={940} y={330} w={30} h={110} />);
    items.push(<Rope key="rope" x1={612} x2={672} y={478} />);
    items.push(<Sculpture key="s1" x={446} y={340} />, <Sculpture key="s2" x={446} y={430} />);
    items.push(<Bench key="b1" x={850} y={340} w={60} />, <Bench key="b2" x={850} y={420} w={60} />);
  }
  return <g pointerEvents="none" fill="none" stroke={LINE} strokeWidth="1.1" strokeOpacity=".45">{items}</g>;
}

/** The hall's plaque at its centre: numeral and title, the record, and the way in. */
function Plaque({ game, open, status }: { game: QuizGame; open: boolean; status: string }) {
  const { cx, cy } = HALLS[game];
  const w = 260;
  const h = 122;
  return (
    <g transform={`translate(${cx - w / 2} ${cy - h / 2})`}>
      <g className="plaque" filter="url(#plaque-shadow)">
        <rect width={w} height={h} rx="3" fill="#FFFDF8" stroke={LINE} strokeOpacity=".5" />
        <text x={w / 2} y="44" textAnchor="middle" fontFamily={SERIF} fill={INK}>
          <tspan fontStyle="italic" fontWeight="600" fontSize="30" fill={HALL_COLOURS[game]}>{GAMES[game].no}</tspan>
          <tspan dx="10" fontWeight="600" fontSize="28">{GAMES[game].title}</tspan>
        </text>
        <text x={w / 2} y="66" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="10.5" letterSpacing="1.4" fill={open ? LINE : "#7A6E62"}>
          {status}
        </text>
        {open ? (
          <g className="plaque-pill">
            <rect x={w / 2 - 58} y="80" width="116" height="30" rx="6" fill={LINE} />
            <text x={w / 2} y="100" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="13" letterSpacing="2" fill="#FFFDF8">ГРАТИ ▸</text>
          </g>
        ) : (
          <g fill="none" stroke={LINE} strokeWidth="1.3"><Rope x1={w / 2 - 48} x2={w / 2 + 48} y={90} /></g>
        )}
      </g>
    </g>
  );
}

// ---------- the rank ladder ----------

/** Beside the plan: the ranks on one vertical scale, «Директор музею» on top; the track is filled up to the best rank so far. */
function RankLadder({ info }: { info: QuizInfo }) {
  const best = Math.max(-1, ...GAME_ORDER.map((g) => bestOf(g, info)?.part ?? -1));
  const current = best < 0 ? -1 : RANKS.length - 1 - RANKS.findIndex(([, name]) => name === rankName(best)); // 0 = visitor
  const levels = RANKS.length - 1;

  return (
    <aside className="flex flex-col rounded-card border border-line bg-surface p-6" aria-label="Звання вікторини">
      <h2 className="font-heading text-[30px] font-semibold leading-none">Звання</h2>
      <p className="t-small mt-2 text-text-secondary">Більше картин — вище звання</p>
      <div className="flex flex-1 items-center">
        <ol className="rank-scale relative mt-6 w-full" style={{ "--filled": current < 0 ? 0 : current / levels } as CSSProperties}>
          {RANKS.map(([min, name], n) => {
            const level = levels - n;
            return (
              <li key={name} className={`rank-row ${level <= current ? "reached" : ""} ${level === current ? "current" : ""}`}>
                <span className="rank-pct">{percent(min)}</span>
                <span className="rank-dot" aria-hidden />
                <span className="rank-name">{name}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
