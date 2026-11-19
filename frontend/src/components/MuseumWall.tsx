/**
 * Home hero: a grainy museum wall (damask wallpaper, gold frieze on top, panelled dado below) with our paintings hung on nails, the project name in the
 * middle. While the visitor scrolls down to read about the project, the paintings swing on their cords
 * and then fall off the wall, one after another (the wall itself stays put: it is sticky for a while).
 * Respects prefers-reduced-motion: then nothing moves and the wall is a plain one-screen hero.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { Frame } from "../api/types";
import { useApi } from "../api/useApi";
import { Artwork } from "./Artwork";

type Box = { l: number; t: number; w: number }; // left / top in % of the wall, width in vw
type Slot = {
  desk: Box;
  mob?: Box; // omitted → not shown on phones
  aspect: string;
  frame: Frame;
  tilt: number; // how it hangs, deg
  swing: number; // how far it swings before falling, deg (sign = direction)
  spin: number; // extra rotation while falling, deg
  delay: number; // 0..1 of scroll progress when it starts to move
};

// Gold border on top, panelled dado along the bottom (≈ last 19 % of the screen); the middle
// (≈ 30–70 % × 34–66 %) stays free for the name.
const SLOTS: Slot[] = [
  { desk: { l: 5, t: 11, w: 11 }, mob: { l: 7, t: 8, w: 34 }, aspect: "4/5", frame: "gold", tilt: -2, swing: -14, spin: -70, delay: 0 },
  { desk: { l: 20, t: 8, w: 8 }, aspect: "1/1", frame: "oak", tilt: 1.5, swing: 10, spin: 50, delay: 0.18 },
  { desk: { l: 35, t: 9, w: 9.5 }, mob: { l: 56, t: 10, w: 36 }, aspect: "4/3", frame: "gallery", tilt: -1, swing: 12, spin: 85, delay: 0.08 },
  { desk: { l: 54, t: 7, w: 8 }, aspect: "3/4", frame: "gold", tilt: 2, swing: -9, spin: -40, delay: 0.3 },
  { desk: { l: 72, t: 10, w: 13 }, aspect: "4/3", frame: "gold", tilt: 1, swing: 15, spin: 95, delay: 0.04 },
  { desk: { l: 4, t: 52, w: 10 }, mob: { l: 6, t: 58, w: 30 }, aspect: "3/4", frame: "oak", tilt: 2.5, swing: 11, spin: 60, delay: 0.22 },
  { desk: { l: 18, t: 58, w: 8.5 }, aspect: "1/1", frame: "mat", tilt: -3, swing: -12, spin: -55, delay: 0.12 },
  { desk: { l: 70, t: 56, w: 8 }, mob: { l: 60, t: 61, w: 28 }, aspect: "4/5", frame: "gallery", tilt: -1.5, swing: -10, spin: -80, delay: 0.26 },
  { desk: { l: 83, t: 50, w: 10 }, aspect: "4/5", frame: "gold", tilt: 3, swing: 13, spin: 65, delay: 0.16 },
];

const CORD = 30; // px from the nail to the top of the frame

const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="discrete" tableValues="0 .2 .5 .8 1"/><feFuncG type="discrete" tableValues="0 .2 .5 .8 1"/><feFuncB type="discrete" tableValues="0 .2 .5 .8 1"/></feComponentTransfer></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>',
)}")`;

export function MuseumWall({ children }: { children: ReactNode }) {
  const sectionRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const mobile = useMediaQuery("(max-width: 767px)");

  const { data } = useApi(() => api.artworks({ limit: 40 }), []);
  const paintings = useMemo(() => shuffle(data?.items ?? []).slice(0, SLOTS.length), [data]);
  const slots = SLOTS.map((s, i) => ({ ...s, i, box: mobile ? s.mob : s.desk })).filter((s) => s.box);

  useEffect(() => {
    if (reduced) {
      itemRefs.current.forEach((el) => el && (el.style.transform = ""));
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const section = sectionRef.current;
      if (!section) return;
      const r = section.getBoundingClientRect();
      const travel = Math.max(1, r.height - window.innerHeight);
      const p = Math.min(1, Math.max(0, -r.top / travel));
      SLOTS.forEach((s, i) => {
        const el = itemRefs.current[i];
        if (!el) return;
        const t = Math.min(1, Math.max(0, (p - s.delay) / 0.6));
        // 0 → .35: swings on its cord (eased); .35 → 1: falls with gravity, spinning.
        const sw = Math.min(1, t / 0.35);
        const swing = Math.sin((sw * Math.PI) / 2) * s.swing;
        const f = Math.max(0, (t - 0.35) / 0.65);
        const fall = f * f * window.innerHeight * 1.25;
        el.style.transform = `translate3d(0, ${fall}px, 0) rotate(${s.tilt + swing + f * s.spin}deg)`;
      });
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduced, mobile]);

  return (
    <section ref={sectionRef} className={`relative ${reduced ? "h-svh" : "h-[175svh]"}`}>
      <div className="sticky top-0 h-svh overflow-hidden bg-[#e6d9c2] text-text">
        <Wallpaper />
        {/* film grain: a small tiled noise, so it stays crisp at any screen size */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-90 mix-blend-overlay" style={{ backgroundImage: GRAIN, backgroundSize: "140px 140px" }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.42] mix-blend-multiply" style={{ backgroundImage: GRAIN, backgroundSize: "100px 100px" }} />
        {/* gallery lighting: brighter in the middle, dimmer at the edges */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_70%_at_50%_42%,transparent_45%,rgba(60,40,20,.38))]" />
        {/* gold Greek-key frieze along the top of the wall */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[14px] border-y border-[#5c4112] shadow-[0_3px_6px_rgba(60,40,20,.3)] md:h-[18px]"
          style={{ backgroundImage: GREEK_KEY, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x", backgroundColor: "#7a5a22" }}
        />
        <Dado />

        {slots.map((s) => {
          const art = paintings[s.i];
          return (
            <div key={s.i} aria-hidden className={`pointer-events-none absolute transition-opacity duration-700 ${art ? "opacity-100" : "opacity-0"}`} style={{ left: `${s.box!.l}%`, top: `${s.box!.t}%`, width: `${s.box!.w}vw` }}>
              {/* the nail stays on the wall */}
              <span className="absolute left-1/2 z-10 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_35%_35%,#f3d98f,#8a6420_70%)] shadow-[1px_2px_3px_rgba(0,0,0,.45)]" style={{ top: -CORD - 4 }} />
              <div
                ref={(el) => { itemRefs.current[s.i] = el; }}
                className="will-change-transform"
                style={{ transform: `rotate(${s.tilt}deg)`, transformOrigin: `50% ${-CORD}px` }}
              >
                <svg className="absolute left-0 w-full overflow-visible" style={{ top: -CORD, height: CORD }} viewBox="0 0 100 30" preserveAspectRatio="none">
                  <path d="M22 30 50 0 78 30" fill="none" stroke="#5b4630" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
                </svg>
                <div className="drop-shadow-[8px_16px_12px_rgba(60,40,20,.45)]">
                  <Artwork src={art?.thumb_url} alt="" aspect={s.aspect} frame={s.frame} size={mobile ? "sm" : "md"} />
                </div>
              </div>
            </div>
          );
        })}

        {/* soft light on the name, so it reads over the pattern */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_34%_24%_at_50%_50%,rgba(250,245,236,.88),rgba(250,245,236,.5)_55%,transparent_80%)]" />
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-[var(--page-gutter)] text-center">{children}</div>
      </div>
    </section>
  );
}

/** Tone-on-tone damask wallpaper (half-drop repeat) over mottled plaster. Tiles in px, so it stays crisp. */
function Wallpaper() {
  return (
    <svg aria-hidden className="absolute inset-0 h-full w-full">
      <defs>
        <g id="damask-half" fill="none" stroke="#cbb894" strokeWidth="4.5" strokeLinecap="round">
          {/* scrolls */}
          <path d="M0 -20C22 -22 40 -38 36 -58 33 -72 16 -70 18 -58 20 -48 31 -50 29 -58" />
          <path d="M2 2C34 -10 60 6 54 38 49 60 26 54 31 37 35 25 47 30 44 39" />
          <path d="M8 -6C24 -2 30 10 22 18" />
          <path d="M4 58C18 60 30 72 26 86 22 96 12 92 14 84" />
          {/* leaves */}
          <path fill="#cfbd9a" stroke="none" d="M0 20C20 24 33 46 24 72 13 62 5 46 0 20Z" />
          <path fill="#cfbd9a" stroke="none" d="M14 -34C30 -40 46 -32 52 -18 38 -16 24 -22 14 -34Z" />
          <path fill="#cfbd9a" stroke="none" d="M40 8C52 2 64 8 66 20 56 22 46 18 40 8Z" />
        </g>
        <g id="damask-motif" fill="none" stroke="#cbb894" strokeWidth="4.5">
          <use href="#damask-half" />
          <use href="#damask-half" transform="scale(-1 1)" />
          <path fill="#cfbd9a" stroke="none" d="M0 -84C16 -62 16 -40 0 -26 -16 -40 -16 -62 0 -84Z" />
          <path fill="#cfbd9a" stroke="none" d="M0 40C9 56 9 70 0 82 -9 70 -9 56 0 40Z" />
          <circle fill="#cfbd9a" stroke="none" r="9" />
          <circle r="16" />
        </g>
        <pattern id="damask" width="200" height="260" patternUnits="userSpaceOnUse">
          <g>
            <use href="#damask-motif" transform="translate(100 130)" />
            <use href="#damask-motif" transform="translate(0 0)" />
            <use href="#damask-motif" transform="translate(200 0)" />
            <use href="#damask-motif" transform="translate(0 260)" />
            <use href="#damask-motif" transform="translate(200 260)" />
            {/* small sprigs between the big motifs */}
            <use href="#damask-motif" transform="translate(0 130) scale(.32)" />
            <use href="#damask-motif" transform="translate(200 130) scale(.32)" />
            <use href="#damask-motif" transform="translate(100 0) scale(.32)" />
            <use href="#damask-motif" transform="translate(100 260) scale(.32)" />
          </g>
        </pattern>
        <filter id="wall-plaster">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="4" seed="5" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer><feFuncA type="table" tableValues="0 0.55" /></feComponentTransfer>
        </filter>
      </defs>
      <rect width="100%" height="100%" fill="#ebe0cb" />
      <rect width="100%" height="100%" fill="url(#damask)" />
      <rect width="100%" height="100%" filter="url(#wall-plaster)" style={{ mixBlendMode: "multiply" }} />
    </svg>
  );
}

/** Panelled dado (boiserie) along the bottom of the wall: chair rail, a row of raised panels, skirting. */
function Dado() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[var(--app-bottom-clearance)] flex h-[clamp(84px,13vh,110px)] flex-col md:h-[clamp(110px,19vh,190px)] bg-[#e4ddd0] shadow-[0_-4px_10px_rgba(60,40,20,.22)]">
      {/* chair rail */}
      <div className="h-[clamp(8px,1.3vh,13px)] shrink-0 border-y border-[#b3a690]" style={{ background: "linear-gradient(#f6f2ea 0 30%,#d8cfbf 30% 55%,#efe9df 55% 75%,#bfb39f)" }} />
      <div className="h-[3px] shrink-0 bg-[#cfc5b4]" />
      <div className="flex min-h-0 flex-1 gap-[clamp(14px,2.2vw,30px)] overflow-hidden px-[clamp(10px,1.6vw,24px)] py-[clamp(10px,2vh,20px)]">
        {Array.from({ length: 40 }, (_, i) => (
          <div key={i} className="aspect-[3/4] h-full shrink-0 rounded-[3px] border border-[#b9ad99] p-[clamp(3px,.45vw,6px)] shadow-[1px_1px_0_#fbf8f2,inset_1px_1px_0_#fbf8f2,0_2px_3px_rgba(60,40,20,.18)]">
            <div className="h-full rounded-[2px] border border-[#c8bca8] shadow-[inset_2px_2px_3px_rgba(60,40,20,.18),inset_-1px_-1px_0_#fbf8f2]" />
          </div>
        ))}
      </div>
      {/* skirting board */}
      <div className="h-[clamp(8px,1.4vh,14px)] shrink-0 border-t border-[#b3a690]" style={{ background: "linear-gradient(#efe9df,#d2c8b6 60%,#b9ad99)" }} />
    </div>
  );
}

const GREEK_KEY = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><defs><linearGradient id="k" x1="0" x2="1"><stop offset="0" stop-color="#b8913c"/><stop offset=".5" stop-color="#f5dc93"/><stop offset="1" stop-color="#a27a2a"/></linearGradient></defs><path d="M3 16V3h10v9H7V7h3" fill="none" stroke="url(#k)" stroke-width="1.8" stroke-linecap="square"/></svg>',
)}")`;

function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
