/**
 * Landing demo: one exhibit under a picture lamp that makes memes by itself.
 *   phrase   — the phrase types itself on the wall label, paintings flick past behind the glass
 *              («ШІ шукає»), land on the match, the lamp switches on, the glass cracks, the caption lands.
 *   painting — the painting hangs, the AI caption types on the label, then lands on the painting.
 * Cycles through EXAMPLES while on screen; a tap on the frame skips ahead, the dots jump.
 * prefers-reduced-motion: no typing / flicking / crack, just the finished memes.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { Artwork, Crack } from "./Artwork";

type Example = { id: number; mode: "phrase" | "painting"; text: string };

const EXAMPLES: Example[] = [
  { id: 29, mode: "phrase", text: "Коли пара о 8:00" },
  { id: 55, mode: "painting", text: "Ще п’ять хвилинок" },
  { id: 107, mode: "phrase", text: "Коли мама кличе вечеряти" },
  { id: 88, mode: "painting", text: "Мої плани на вихідні" },
];

const TYPE_MS = 65; // per letter
const SEARCH_MS = 1500; // paintings flick past after the phrase is typed
const HOLD_MS = 3800; // the finished meme stays this long

type Phase = "type" | "search" | "reveal";

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function MemeDemo() {
  const { data: works } = useApi(() => Promise.all(EXAMPLES.map((e) => api.artwork(e.id))), []);
  const { data: pool } = useApi(() => api.artworks({ limit: 16 }), []);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("type");
  const [typed, setTyped] = useState(0);
  const [flick, setFlick] = useState(0);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [still] = useState(reducedMotion);

  const ex = EXAMPLES[idx];
  const work = works?.[idx];
  const shuffle = (pool?.items ?? []).map((a) => a.thumb_url).filter((u) => u !== work?.thumb_url);

  // Play only while the exhibit is on screen.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The timeline of one example.
  useEffect(() => {
    if (still || !works) {
      setPhase("reveal");
      setTyped(ex.text.length);
      return;
    }
    if (!visible) return; // paused off screen
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    setPhase("type");
    setTyped(0);
    const start = ex.mode === "painting" ? 800 : 300;
    for (let n = 1; n <= ex.text.length; n++) later(start + n * TYPE_MS, () => setTyped(n));
    const typedAt = start + ex.text.length * TYPE_MS;
    let revealAt = typedAt + 400;
    if (ex.mode === "phrase") {
      later(typedAt + 200, () => setPhase("search"));
      revealAt = typedAt + 200 + SEARCH_MS;
    }
    later(revealAt, () => setPhase("reveal"));
    later(revealAt + HOLD_MS, () => setIdx((i) => (i + 1) % EXAMPLES.length));
    return () => timers.forEach(clearTimeout);
  }, [idx, works, visible, still, ex]);

  // Paintings flicking behind the glass: slow and blurred while typing, fast while searching.
  const flicking = ex.mode === "phrase" && phase !== "reveal" && shuffle.length > 0;
  useEffect(() => {
    if (!flicking) return;
    const t = window.setInterval(() => setFlick((f) => f + 1), phase === "search" ? 110 : 450);
    return () => clearInterval(t);
  }, [flicking, phase]);

  const src = flicking ? shuffle[flick % shuffle.length] : work?.thumb_url;
  const lit = phase === "reveal";
  const typing = typed < ex.text.length;

  return (
    <div ref={root} className="flex w-full max-w-[880px] flex-col items-center gap-6 md:flex-row md:justify-center md:gap-14">
      {/* The exhibit, under its picture lamp */}
      <div className="relative w-[min(76vw,340px)] shrink-0 pt-9">
        <div aria-hidden className={`picture-lamp ${lit ? "is-lit" : ""}`} />
        <button
          type="button"
          onClick={() => setIdx((i) => (i + 1) % EXAMPLES.length)}
          aria-label="Наступний приклад"
          className="relative block w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <Artwork aspect="4/5">
            <div className={`demo-stage ${flicking ? "is-flicking" : ""} ${phase === "search" ? "is-searching" : ""}`}>
              {src && <img src={src} alt="" crossOrigin="anonymous" className="demo-img" />}
              {lit && <span key={`c${idx}`} className={`demo-caption ${still ? "" : "is-stamped"}`} aria-hidden>{ex.text}</span>}
              {lit && !still && <Crack key={`k${idx}`} mode="fleeting" />}
            </div>
          </Artwork>
          <div aria-hidden className={`lamp-glow ${lit ? "is-lit" : ""}`} />
        </button>
      </div>

      {/* Its wall label */}
      <div className="w-full max-w-[340px] text-left">
        <div className="t-label">{ex.mode === "phrase" ? "Ваша фраза" : "ШІ пише підпис"}</div>
        <p className="demo-typed mt-3">
          {ex.text.slice(0, typed)}
          {(typing || phase === "type") && <span className="demo-caret" aria-hidden />}
        </p>
        <div className="mt-5 min-h-[92px] border-t border-line pt-4">
          <div className="t-small text-text-secondary">
            {ex.mode === "painting" ? "Картина" : phase === "search" ? "ШІ шукає картину…" : lit ? "ШІ знайшов" : " "}
          </div>
          {work && (ex.mode === "painting" || lit) && (
            <div key={`w${idx}`} className="demo-found">
              <div className="t-strong mt-1">{work.artist.name}</div>
              <div className="font-heading text-xl italic">«{work.title}»{work.year ? `, ${work.year}` : ""}</div>
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <Link to="/gallery#memes" className="t-strong inline-flex min-h-11 items-center text-accent hover:underline">Більше мемів →</Link>
          <div className="flex" role="group" aria-label="Приклади">
            {EXAMPLES.map((e, i) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`Приклад ${i + 1}`}
                aria-current={i === idx}
                className="flex h-11 w-7 items-center justify-center focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className={`block h-2 rounded-full transition-all duration-300 ${i === idx ? "w-5 bg-accent" : "w-2 bg-accent-soft"}`} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
