/**
 * «Про проєкт» header: a pencil-drawn вінок with words hanging from it — letters one under another, held by
 * an invisible thread. They sway in the wind and swing away from the cursor / finger;
 * with sound on, brushing across a thread plucks it like a bandura string.
 * Physics: each word is a verlet chain (node 0 pinned under the wreath). Drawn on a canvas; the wreath is SVG on top.
 * prefers-reduced-motion → letters hang still (no wind), touching still nudges them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";

// Left → right. The middle three read as our motto.
const WORDS = ["МЕМИ", "КАРТИНИ", "МИСТЕЦТВО", "КРІЗЬ", "ЖАРТИ", "ІСТОРІЇ", "ФАКТИ"];
// Bandura-ish: a Ukrainian-minor scale (A B C D# E F# G), low → high from left to right.
const NOTES = [220, 246.94, 261.63, 311.13, 329.63, 369.99, 392];

const VIEW_W = 600; // wreath SVG viewBox
const VIEW_H = 214;
const RING = { cx: 300, cy: 106, rx: 262, ry: 74 };

type Node = { x: number; y: number; px: number; py: number };

/** `paper` is the colour behind the wreath: blossoms and leaves are filled with it, so they hide the wire behind them. */
export function WordWreath({ paper = "#FCFAF6" }: { paper?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [soundOn, setSoundOn] = useState(false);
  const sound = useRef<Bandura | null>(null);

  useEffect(() => {
    if (soundOn && !sound.current) sound.current = new Bandura();
    if (sound.current) sound.current.enabled = soundOn;
  }, [soundOn]);
  useEffect(() => () => sound.current?.close(), []);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0, font = 30, seg = 33, wreathW = 0, wreathLeft = 0;
    let strands: Node[][] = [];
    const lastPluck = WORDS.map(() => 0);

    const layout = () => {
      W = wrap.clientWidth;
      font = W < 480 ? 16 : W < 768 ? 18 : 20;
      seg = font * 1.3;
      wreathW = Math.min(580, W * 0.94);
      wreathLeft = (W - wreathW) / 2;
      const s = wreathW / VIEW_W;
      const longest = Math.max(...WORDS.map((w) => w.length));
      H = Math.round(RING.cy * s + RING.ry * s + (longest + 1.5) * seg + 40);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = `${H}px`;
      wrap.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      strands = WORDS.map((word, i) => {
        const a = anchor(i);
        return Array.from({ length: word.length + 2 }, (_, j) => ({ x: a.x, y: a.y + j * seg, px: a.x, py: a.y + j * seg }));
      });
    };

    /** Pin point of word i: just under the front-bottom arc of the ring. */
    const anchor = (i: number) => {
      const s = wreathW / VIEW_W;
      const deg = 155 - (i * (155 - 25)) / (WORDS.length - 1); // left (155°) → right (25°)
      const t = (deg * Math.PI) / 180;
      return { x: wreathLeft + (RING.cx + RING.rx * Math.cos(t)) * s, y: (RING.cy + RING.ry * Math.sin(t) + 18) * s }; // just below the front flowers
    };

    // Pointer: position + velocity, in canvas CSS px.
    const pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0, active: false, lastX: -1e4, lastY: -1e4 };
    const toLocal = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      const p = toLocal(e);
      if (pointer.active) {
        pointer.vx = p.x - pointer.x;
        pointer.vy = p.y - pointer.y;
        pluckCrossings(pointer.x, pointer.y, p.x, p.y);
      }
      pointer.x = p.x; pointer.y = p.y; pointer.active = true;
    };
    const onLeave = () => { pointer.active = false; pointer.x = pointer.y = -1e4; pointer.vx = pointer.vy = 0; };
    const onDown = (e: PointerEvent) => {
      // a tap: flick the nearest word sideways and pluck it
      const p = toLocal(e);
      let best = -1, bestD = 60;
      strands.forEach((nodes, i) => nodes.forEach((n) => {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < bestD) { bestD = d; best = i; }
      }));
      if (best < 0) return;
      const dir = p.x < strands[best][2].x ? 1 : -1;
      strands[best].forEach((n, j) => { if (j) n.px -= dir * 6 * (j / strands[best].length + 0.3); });
      pluck(best);
    };

    const pluck = (i: number) => {
      const now = performance.now();
      if (now - lastPluck[i] < 140) return;
      lastPluck[i] = now;
      sound.current?.pluck(NOTES[i]);
    };

    /** A cursor stroke that crosses a word's thread plucks it. */
    const pluckCrossings = (x1: number, y1: number, x2: number, y2: number) => {
      if (x1 === x2 && y1 === y2) return;
      strands.forEach((nodes, i) => {
        for (let j = 0; j < nodes.length - 1; j++) {
          if (segmentsCross(x1, y1, x2, y2, nodes[j].x, nodes[j].y, nodes[j + 1].x, nodes[j + 1].y)) {
            pluck(i);
            return;
          }
        }
      });
    };

    let raf = 0, visible = true, t0 = performance.now();
    const step = (now: number) => {
      raf = 0;
      const t = (now - t0) / 1000;
      strands.forEach((nodes, i) => {
        const a = anchor(i);
        nodes[0].x = nodes[0].px = a.x;
        nodes[0].y = nodes[0].py = a.y;
        for (let j = 1; j < nodes.length; j++) {
          const n = nodes[j];
          let vx = (n.x - n.px) * 0.97;
          let vy = (n.y - n.py) * 0.97;
          // wind: slow gusts + a little flutter, stronger lower down
          const wind = reduced ? 0 : (Math.sin(t * 0.7 + i * 0.9) * 0.6 + Math.sin(t * 1.9 + i * 2.3 + j * 0.5) * 0.35 + Math.sin(t * 0.23) * 0.4) * (W < 768 ? 0.028 : 0.045) * (0.4 + j / nodes.length);
          vx += wind;
          vy += 0.45; // gravity
          // the cursor pushes letters away and drags them along its motion
          if (pointer.active) {
            const dx = n.x - pointer.x, dy = n.y - pointer.y;
            const d = Math.hypot(dx, dy);
            const R = font * 2.2;
            if (d < R && d > 0.01) {
              const k = (1 - d / R);
              vx += (dx / d) * k * 2.4 + pointer.vx * k * 0.2;
              vy += (dy / d) * k * 2.4 + pointer.vy * k * 0.08;
            }
          }
          n.px = n.x; n.py = n.y;
          n.x += vx; n.y += vy;
        }
        // keep letter spacing (rope constraints)
        for (let it = 0; it < 6; it++) {
          for (let j = 1; j < nodes.length; j++) {
            const p = nodes[j - 1], n = nodes[j];
            const dx = n.x - p.x, dy = n.y - p.y;
            const d = Math.hypot(dx, dy) || 0.001;
            const diff = (d - seg) / d;
            if (j === 1) { n.x -= dx * diff; n.y -= dy * diff; }
            else { p.x += dx * diff * 0.5; p.y += dy * diff * 0.5; n.x -= dx * diff * 0.5; n.y -= dy * diff * 0.5; }
          }
        }
      });
      pointer.vx *= 0.6; pointer.vy *= 0.6;
      draw();
      if (visible) raf = requestAnimationFrame(step);
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `600 ${font}px "Cormorant Garamond", serif`;
      ctx.fillStyle = "#1f1b18";
      strands.forEach((nodes, i) => {
        // letters only, no visible thread; the first link is bare so the word starts below the flowers.
        // Letters barely turn with their link, so each word stays an upright, tidy column while it sways.
        for (let j = 2; j < nodes.length; j++) {
          const p = nodes[j - 1], n = nodes[j];
          const ang = Math.atan2(n.x - p.x, n.y - p.y);
          ctx.save();
          ctx.translate((p.x + n.x) / 2, (p.y + n.y) / 2);
          ctx.rotate(-ang * 0.2);
          ctx.fillText(WORDS[i][j - 2], 0, 0);
          ctx.restore();
        }
      });
    };

    const kick = () => { if (!raf && visible) raf = requestAnimationFrame(step); };
    layout();
    document.fonts?.ready.then(() => draw());
    kick();

    const ro = new ResizeObserver(() => { layout(); draw(); });
    ro.observe(wrap);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) { t0 = performance.now() - 0; kick(); }
    });
    io.observe(wrap);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
    };
  }, []);

  return (
    <div className="relative">
      <div ref={wrapRef} className="relative mx-auto w-full" role="img" aria-label={`Вінок, з якого звисають слова: ${WORDS.join(", ").toLowerCase()}`}>
        <canvas ref={canvasRef} className="absolute inset-0 block w-full touch-pan-y" />
        <Wreath paper={paper} />
      </div>
      <button
        type="button"
        onClick={() => setSoundOn((v) => !v)}
        aria-pressed={soundOn}
        aria-label={soundOn ? "Вимкнути звук бандури" : "Увімкнути звук бандури"}
        title={soundOn ? "Вимкнути звук" : "Увімкнути звук"}
        className={`absolute right-0 bottom-0 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface transition hover:text-accent focus-visible:outline-2 focus-visible:outline-accent ${soundOn ? "text-accent" : "text-text-secondary"}`}
      >
        <Icon name={soundOn ? "sound" : "soundOff"} size={16} />
      </button>
    </div>
  );
}

/**
 * The вінок, drawn like a pencil sketch: a thin wire ring seen slightly from above, with small blossoms, buds,
 * leaves, clover heads and two bows. Shapes are filled with the page colour, so the front ones hide the wire
 * behind them; every line is drawn twice, a little offset, and broken up by a graphite-grain filter.
 */
function Wreath({ paper }: { paper: string }) {
  const items = useMemo(() => {
    type Kind = "blossom" | "bud" | "leaf" | "clover" | "bow";
    type Item = { kind: Kind; x: number; y: number; rot: number; s: number; depth: number; flip: boolean };
    const kinds: Kind[] = ["blossom", "leaf", "bud", "clover", "leaf", "blossom", "bud", "leaf"];
    const out: Item[] = [];
    let k = 0;
    for (let d = 3; d < 360; d += 9, k++) {
      const t = (d * Math.PI) / 180;
      const x = RING.cx + RING.rx * Math.cos(t);
      const y = RING.cy + RING.ry * Math.sin(t);
      const depth = (Math.sin(t) + 1) / 2; // 0 back (top) → 1 front (bottom)
      const normal = (Math.atan2(RING.rx * Math.sin(t), RING.ry * Math.cos(t)) * 180) / Math.PI; // outward
      const kind: Kind = d === 111 || d === 228 ? "bow" : kinds[k % kinds.length];
      const jitter = ((k * 53) % 30) - 15;
      out.push({ kind, x, y, rot: kind === "bow" ? jitter * 0.4 : normal + 90 + jitter, s: 1.25 + depth * 0.6, depth, flip: k % 2 === 0 });
    }
    return out.sort((a, b) => a.depth - b.depth);
  }, []);

  const ring = `M${RING.cx - RING.rx} ${RING.cy}a${RING.rx} ${RING.ry} 0 1 0 ${RING.rx * 2} 0a${RING.rx} ${RING.ry} 0 1 0 ${-RING.rx * 2} 0`;

  return (
    <svg aria-hidden className="pointer-events-none absolute top-0 left-1/2 w-[min(580px,94%)] -translate-x-1/2 overflow-visible" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
      <defs>
        <filter id="ww-pencil" x="-5%" y="-20%" width="110%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="2" result="wobble" />
          <feDisplacementMap in="SourceGraphic" in2="wobble" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="drawn" />
          <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="4" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.6 0 0 0 -0.3" result="mask" />
          <feComposite in="drawn" in2="mask" operator="in" />
        </filter>
      </defs>
      <g filter="url(#ww-pencil)" style={{ fill: paper }} stroke="#2c2724" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {/* the wire, sketched in three passes */}
        <path d={ring} fill="none" />
        <path d={ring} fill="none" transform="translate(1.4 -1) rotate(0.5 300 106)" opacity=".55" />
        <path d={ring} fill="none" transform="translate(-1 1.6) rotate(-0.4 300 106)" opacity=".4" strokeWidth="1" />
        {items.map((it, i) => (
          <g key={i} transform={`translate(${it.x.toFixed(1)} ${it.y.toFixed(1)}) rotate(${it.rot.toFixed(1)}) scale(${(it.flip ? -it.s : it.s).toFixed(2)} ${it.s.toFixed(2)})`} opacity={0.7 + it.depth * 0.3}>
            <Sketch kind={it.kind} />
            <g transform="translate(.7 .5) rotate(2)" opacity=".45" fill="none"><Sketch kind={it.kind} /></g>
          </g>
        ))}
      </g>
    </svg>
  );
}

function Sketch({ kind }: { kind: "blossom" | "bud" | "leaf" | "clover" | "bow" }) {
  switch (kind) {
    case "blossom":
      return (
        <g transform="translate(0 -9)">
          {[0, 72, 144, 216, 288].map((a) => <path key={a} d="M0 0C-5 -3 -6 -10 0 -12 6 -10 5 -3 0 0Z" transform={`rotate(${a})`} />)}
          <circle r="2.4" />
          <path d="M0 2.4V9" fill="none" />
        </g>
      );
    case "bud":
      return (
        <g>
          <path d="M0 0Q3 -8 1 -15M0 -4Q-6 -9 -7 -14" fill="none" />
          <ellipse cx="1" cy="-19" rx="3.4" ry="4.8" />
          <ellipse cx="-7.5" cy="-17.5" rx="2.6" ry="3.6" transform="rotate(-20 -7.5 -17.5)" />
        </g>
      );
    case "leaf":
      return (
        <g>
          <path d="M0 0C4 -7 11 -9 18 -7 12 -1 6 1 0 0Z" />
          <path d="M1 -.6Q9 -4.5 16.5 -6.5" fill="none" />
        </g>
      );
    case "clover":
      return (
        <g>
          <path d="M-8 -2Q0 3 8 -2" fill="none" />
          {[-150, -130, -110, -90, -70, -50, -30].map((a) => {
            const r = (a * Math.PI) / 180;
            return <path key={a} d={`M${(Math.cos(r) * 3).toFixed(1)} ${(Math.sin(r) * 3 - 1).toFixed(1)}L${(Math.cos(r) * 12).toFixed(1)} ${(Math.sin(r) * 12 - 3).toFixed(1)}`} fill="none" />;
          })}
        </g>
      );
    case "bow":
      return (
        <g>
          <path d="M0 0C-6 -9 -18 -8 -16 0 -14 6 -6 4 0 0Z" />
          <path d="M0 0C6 -9 18 -8 16 0 14 6 6 4 0 0Z" />
          <path d="M0 0Q-4 10 -8 20M0 0Q4 11 6 21" fill="none" />
          <circle r="2.6" />
        </g>
      );
  }
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return o(ax, ay, bx, by, cx, cy) !== o(ax, ay, bx, by, dx, dy) && o(cx, cy, dx, dy, ax, ay) !== o(cx, cy, dx, dy, bx, by);
}

/** Plucked string (Karplus–Strong), synthesised once per note; warm and short, a little like a bandura. */
class Bandura {
  enabled = true;
  private ctx = new AudioContext();
  private out: GainNode;
  private cache = new Map<number, AudioBuffer>();

  constructor() {
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.35;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3200;
    this.out.connect(lp).connect(this.ctx.destination);
  }

  private buffer(freq: number) {
    let buf = this.cache.get(freq);
    if (buf) return buf;
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * 2.2);
    buf = this.ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    const period = Math.round(rate / freq);
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const next = (idx + 1) % period;
      const v = 0.996 * 0.5 * (ring[idx] + ring[next]);
      data[i] = ring[idx];
      ring[idx] = v;
      idx = next;
    }
    this.cache.set(freq, buf);
    return buf;
  }

  pluck(freq: number) {
    if (!this.enabled) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer(freq);
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0.9, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 2);
    src.connect(g).connect(this.out);
    src.start(now);
    src.stop(now + 2.1);
  }

  close() {
    void this.ctx.close();
  }
}
